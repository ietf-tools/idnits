#!/usr/bin/env python3
"""Generate lib/config/xml2rfc-boilerplate.mjs, the boilerplate text that
xml2rfc's prep tool puts in <front><boilerplate> (lib/modules/xml.mjs checks
the boilerplate of prepped RFCs against it).

The text is taken from an xml2rfc source tree: the RFC 7841 "Status of This
Memo" text (xml2rfc/boilerplate_rfc_7841.py), the Trust Legal Provisions
"Copyright Notice" text (xml2rfc/boilerplate_tlp.py) and the I-D "Status of
This Memo" text (xml2rfc/boilerplate_id_guidelines.py). The dates on which
each version of the TLP applies, and the date from which URLs use https, are
taken from the prep tool (xml2rfc/writers/preptool.py), so that a new version
of the TLP is picked up by running this script again once xml2rfc has it.

Published RFCs keep the boilerplate of the xml2rfc release that prepped them,
and xml2rfc has changed some of its text over time (e.g. "Simplified BSD
License" to "Revised BSD License" in 3.11.0). So the RFC 7841 and TLP text of
earlier versions is taken from the git history of the checkout, back to the
first version written as <t> paragraphs (2.17.0, before the first prepped RFC),
with the date of the first release that replaced it.

The source files are read with the ast module, never imported or run.
Whitespace in the text is collapsed, as the checker compares it after
collapsing whitespace anyway. The xml2rfc version and commit are recorded in
the generated file.

Usage (the checkout needs its full history and tags, so no --depth):
  git clone https://github.com/ietf-tools/xml2rfc /path/to/xml2rfc
  python3 -I scripts/generate-xml2rfc-boilerplate.py /path/to/xml2rfc > lib/config/xml2rfc-boilerplate.mjs
"""
import argparse
import ast
import datetime
import os
import re
import subprocess
import sys


# Release tags of xml2rfc (cli/2.x.y and cli/3.x.y before the move of the code to the root, v3.x.y after)
RELEASE_TAG_RE = re.compile(r'(?:cli/|v)?[0-9]+\.[0-9]+\.[0-9]+')


def source_value(source, path, name):
    """Return the literal value assigned to name at the top level of a module"""
    tree = ast.parse(source, path)
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return ast.literal_eval(node.value)
    sys.exit('%s: no assignment to %s' % (path, name))


def module_value(path, name):
    with open(path, encoding='utf-8') as f:
        return source_value(f.read(), path, name)


def git(repo, *args):
    return subprocess.run(['git', '-C', repo, *args], capture_output=True, text=True, check=True).stdout


def release_date(repo, commit):
    """Return the date of the first release that contains a commit"""
    for tag in git(repo, 'tag', '--contains', commit, '--sort=creatordate').split():
        if RELEASE_TAG_RE.fullmatch(tag):
            return git(repo, 'log', '-1', '--format=%cs', tag).strip()
    return None


def slots(data, depth, prefix=()):
    """Flatten nested dicts down to depth levels of keys, as {keys: paragraphs}"""
    if depth == 0:
        return {prefix: data}
    result = {}
    for key, value in data.items():
        result.update(slots(value, depth - 1, prefix + (key,)))
    return result


def history(repo, name, var, depth):
    """Return the earlier versions of a boilerplate dict, newest first

    Each entry has the date of the release that replaced the version, the
    commit that did, and the slots (paragraph lists, by keys) that differ in
    that version from the one that replaced it (null for a slot it didn't have).
    Versions not written as <t> paragraphs are left out, as is anything older.
    """
    paths = ['xml2rfc/' + name, 'cli/xml2rfc/' + name]
    versions = []
    for commit in git(repo, 'log', '--format=%H', '--', *paths).split():
        for path in paths:
            try:
                source = git(repo, 'show', '%s:%s' % (commit, path))
                break
            except subprocess.CalledProcessError:
                continue
        else:
            continue  # -> the commit removed the file at one path (move)
        try:
            data = slots(normalize(source_value(source, path, var), depth), depth)
        except (NotParagraphs, AttributeError):
            break
        if versions and versions[-1][1] == data:
            # -> Same text (e.g. a move): the version dates from the oldest commit
            versions[-1] = (commit, data)
        else:
            versions.append((commit, data))

    result = []
    for (newer_commit, newer), (_, older) in zip(versions, versions[1:]):
        changed = [{'keys': list(keys), 'paragraphs': older.get(keys)} for keys in newer if older.get(keys) != newer[keys]]
        changed += [{'keys': list(keys), 'paragraphs': paras} for keys, paras in older.items() if keys not in newer]
        result.append({'until': release_date(repo, newer_commit), 'commit': newer_commit, 'slots': changed})
    return result


def date_value(node):
    """Return the ISO date of a datetime.date(year=..., month=..., day=...) call"""
    if not (isinstance(node, ast.Call) and ast.unparse(node.func) in ('datetime.date', 'date')):
        sys.exit('Expected a datetime.date() call, found %s' % ast.unparse(node))
    args = [ast.literal_eval(a) for a in node.args]
    kwargs = {k.arg: ast.literal_eval(k.value) for k in node.keywords}
    return datetime.date(*args, **kwargs).isoformat()


def find_function(tree, name):
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    sys.exit('preptool.py: no function %s' % name)


def assigned_constant(body, name):
    """Return the constant assigned to name in a block, or None if it is assigned something else"""
    for node in body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return node.value.value if isinstance(node.value, ast.Constant) else None
    sys.exit('preptool.py: no assignment to %s in %s' % (name, ast.unparse(body[0])))


def preptool_dates(path):
    """Return the https cutover date and the TLP periods of the prep tool

    The periods come from the if/elif chain on self.date in
    boilerplate_insert_copyright_notice(): each branch picks the TLP version
    ('tlp') and either a fixed copyright text ('stream', e.g. 'n/a') or the
    text by stream (None). The branch before the first start date stops the
    prep tool (no copyright text before TLP 2.0).
    """
    with open(path, encoding='utf-8') as f:
        tree = ast.parse(f.read(), path)

    https_date = None
    for node in ast.walk(find_function(tree, '__init__')):
        if isinstance(node, ast.Assign) and ast.unparse(node.targets[0]) == 'self.boilerplate_https_date':
            https_date = date_value(node.value)
    if not https_date:
        sys.exit('preptool.py: no self.boilerplate_https_date')

    func = find_function(tree, 'boilerplate_insert_copyright_notice')
    start_dates = {}
    for node in ast.walk(func):
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) and re.fullmatch(r'tlp_\w+_start_date', node.targets[0].id):
            start_dates[node.targets[0].id] = date_value(node.value)

    chain = next((n for n in func.body if isinstance(n, ast.If) and ast.unparse(n.test).startswith('self.date <')), None)
    if chain is None:
        sys.exit('preptool.py: no if/elif chain on self.date in boilerplate_insert_copyright_notice')
    periods = []
    start = None
    node = chain
    while True:
        test = node.test
        if not (isinstance(test, ast.Compare) and ast.unparse(test.left) == 'self.date' and isinstance(test.ops[0], ast.Lt)
                and isinstance(test.comparators[0], ast.Name) and test.comparators[0].id in start_dates):
            sys.exit('preptool.py: unexpected test %s' % ast.unparse(test))
        end = start_dates[test.comparators[0].id]
        if start is not None:
            periods.append({'from': start, 'tlp': assigned_constant(node.body, 'tlp'), 'stream': assigned_constant(node.body, 'stream')})
        start = end
        if len(node.orelse) == 1 and isinstance(node.orelse[0], ast.If):
            node = node.orelse[0]
            continue
        periods.append({'from': start, 'tlp': assigned_constant(node.orelse, 'tlp'), 'stream': assigned_constant(node.orelse, 'stream')})
        break
    return https_date, periods


class NotParagraphs(Exception):
    pass


def paragraphs(texts):
    """Return the content of each <t> of a list of boilerplate paragraphs, whitespace collapsed"""
    result = []
    for text in texts:
        text = ' '.join(text.split())
        m = re.fullmatch(r'<t>(.*)</t>', text)
        if not m:
            raise NotParagraphs(text)
        result.append(m.group(1).strip())
    return result


def normalize(data, depth):
    """Apply paragraphs() to the lists of a boilerplate dict, depth levels of keys down"""
    if depth == 0:
        return paragraphs(data)
    return {key: normalize(value, depth - 1) for key, value in data.items()}


def js(value, indent=0):
    """Serialize a value as JavaScript in the style of the code base"""
    pad = '  ' * (indent + 1)
    if isinstance(value, str):
        if "'" in value and '"' not in value:
            return '"%s"' % value.replace('\\', '\\\\')
        return "'%s'" % value.replace('\\', '\\\\').replace("'", "\\'")
    if value is None:
        return 'null'
    if isinstance(value, list):
        if not value:
            return '[]'
        if all(isinstance(v, str) for v in value) and sum(len(v) + 4 for v in value) < 60:
            return '[%s]' % ', '.join(js(v) for v in value)
        return '[\n%s\n%s]' % (',\n'.join(pad + js(v, indent + 1) for v in value), '  ' * indent)
    if isinstance(value, dict):
        def key(k):
            return k if re.fullmatch(r'[A-Za-z_$][\w$]*', k) else js(k)
        return '{\n%s\n%s}' % (',\n'.join('%s%s: %s' % (pad, key(k), js(v, indent + 1)) for k, v in value.items()), '  ' * indent)
    sys.exit('Cannot serialize %r' % (value,))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('xml2rfc', help='path to a git checkout of xml2rfc, with its history and tags')
    args = parser.parse_args()

    repo = args.xml2rfc
    try:
        if git(repo, 'rev-parse', '--is-shallow-repository').strip() != 'false':
            sys.exit('%s is a shallow clone: the history of the boilerplate is needed' % repo)
        commit = git(repo, 'rev-parse', 'HEAD').strip()
    except (OSError, subprocess.CalledProcessError):
        sys.exit('%s is not a git checkout of xml2rfc' % repo)
    pkg = os.path.join(repo, 'xml2rfc')
    version = module_value(os.path.join(pkg, '__init__.py'), '__version__')

    try:
        rfc_status = normalize(module_value(os.path.join(pkg, 'boilerplate_rfc_7841.py'), 'boilerplate_rfc_status_of_memo'), 3)
        tlp = normalize(module_value(os.path.join(pkg, 'boilerplate_tlp.py'), 'boilerplate_tlp'), 2)
        draft_status = paragraphs(module_value(os.path.join(pkg, 'boilerplate_id_guidelines.py'), 'boilerplate_draft_status_of_memo'))
    except NotParagraphs as e:
        sys.exit('Expected a <t> paragraph, found %s' % e)
    https_date, periods = preptool_dates(os.path.join(pkg, 'writers', 'preptool.py'))
    rfc_status_history = history(repo, 'boilerplate_rfc_7841.py', 'boilerplate_rfc_status_of_memo', 3)
    tlp_history = history(repo, 'boilerplate_tlp.py', 'boilerplate_tlp', 2)
    for period in periods:
        if period['tlp'] not in tlp:
            sys.exit('preptool.py uses TLP %s, which boilerplate_tlp.py does not have' % period['tlp'])

    print('/**')
    print(' * Boilerplate text that xml2rfc\'s prep tool puts in <front><boilerplate>.')
    print(' *')
    print(' * GENERATED FILE, do not edit: run scripts/generate-xml2rfc-boilerplate.py to regenerate it.')
    print(' * From xml2rfc %s (commit %s): xml2rfc/boilerplate_rfc_7841.py,' % (version, commit))
    print(' * xml2rfc/boilerplate_tlp.py, xml2rfc/boilerplate_id_guidelines.py and the dates')
    print(' * in xml2rfc/writers/preptool.py.')
    print(' *')
    print(' * Each paragraph is the content of a <t> element, whitespace collapsed, with the')
    print(' * placeholders of the prep tool: {scheme}, {rfc_number}, {group_name}, {year} and')
    print(' * {expiration_date}.')
    print(' */')
    print('export const XML2RFC_BOILERPLATE_SOURCE = %s' % js({'version': version, 'commit': commit}))
    print()
    print('// URLs in the boilerplate use https from this date of the document, http before')
    print('// (self.boilerplate_https_date in preptool.py)')
    print('export const BOILERPLATE_HTTPS_DATE = %s' % js(https_date))
    print()
    print('// TLP version of the copyright notice by date of the document, from the first date')
    print('// it applies (boilerplate_insert_copyright_notice() in preptool.py). The stream is')
    print('// the part of the TLP text used, or null for "IETF" in the IETF stream and "alt" in')
    print('// the others. There is no copyright notice before the first date.')
    print('export const TLP_PERIODS = %s' % js(periods))
    print()
    print('// RFC 7841 "Status of This Memo" paragraphs, by stream, category and consensus')
    print('export const RFC_STATUS_OF_MEMO = %s' % js(rfc_status))
    print()
    print('// "Copyright Notice" paragraphs, by TLP version and part (stream, "n/a" for all')
    print('// streams, or the ipr variant: "noModification", "noDerivatives", "pre5378")')
    print('export const TLP_COPYRIGHT_NOTICE = %s' % js(tlp))
    print()
    print('// Earlier versions of RFC_STATUS_OF_MEMO and TLP_COPYRIGHT_NOTICE, newest first:')
    print('// the paragraphs (by keys, null where there were none) that xml2rfc generated')
    print('// until the release of the given date, which replaced them in the given commit')
    print('export const RFC_STATUS_OF_MEMO_HISTORY = %s' % js(rfc_status_history))
    print()
    print('export const TLP_COPYRIGHT_NOTICE_HISTORY = %s' % js(tlp_history))
    print()
    print('// Internet-Draft "Status of This Memo" paragraphs')
    print('export const DRAFT_STATUS_OF_MEMO = %s' % js(draft_status))


if __name__ == '__main__':
    main()
