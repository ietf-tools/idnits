<div align="center">
    
<img src="https://raw.githubusercontent.com/ietf-tools/common/main/assets/logos/idnits.svg" alt="IDNITS" height="125" />
    
[![Release](https://img.shields.io/github/release/ietf-tools/idnits.svg?style=flat&maxAge=600)](https://github.com/ietf-tools/idnits/releases)
[![License](https://img.shields.io/github/license/ietf-tools/idnits)](https://github.com/ietf-tools/idnits/blob/v3/LICENSE)
[![npm](https://img.shields.io/npm/v/@ietf-tools/idnits)](https://www.npmjs.com/package/@ietf-tools/idnits)
[![node-current](https://img.shields.io/node/v/@ietf-tools/idnits)](https://github.com/ietf-tools/idnits)
    
##### Library / CLI to inspect Internet-Draft documents for a variety of conditions to conform with IETF policies.
    
</div>

- [Installation](#installation)
- [Usage](#usage)
- [Contributing](https://github.com/ietf-tools/.github/blob/main/CONTRIBUTING.md)

---

### Installation

1. Install [Node.js 18.x or later](https://nodejs.org/)
2. Install idnits:

```sh
npm install -g idnits
```

### Usage

#### As a CLI

```sh
idnits [args] <file>
```

| Arguments          | Description                                               |
|--------------------|-----------------------------------------------------------|
| `--version`        | Print the version and exit                                |
| `--help`           | Print the help text and exit                              |
| `--nowarn`         | Don't issue warnings, only ID-Checklist violations        |
| `--verbose`        | Show more information about offending lines               |
| `--nitcount`       | Show a count of nits                                      |
| `--debug`          | Debug output, especially of boilerplate matching          |
| `--year <year>`    | Expect the given year in the boilerplate                  |
| `--checklistwarn`  | Only warn (no errors) for ID-Checklist violations         |
| `--nonascii`       | Disable warnings for non-ascii characters                 |
| `--submitcheck`    | Only output errors and warnings related to 1id-guidelines |
| `--status <doctype>` | Assume the given intended document type                   |

#### As a library

*TODO*
