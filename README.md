<div align="center">
    
<img src="https://raw.githubusercontent.com/ietf-tools/common/main/assets/logos/idnits.svg" alt="IDNITS" height="125" />
    
[![npm](https://img.shields.io/npm/v/@ietf-tools/idnits)](https://www.npmjs.com/package/@ietf-tools/idnits)
[![node-current](https://img.shields.io/node/v/@ietf-tools/idnits)](https://github.com/ietf-tools/idnits)
[![License](https://img.shields.io/github/license/ietf-tools/idnits)](https://github.com/ietf-tools/idnits/blob/v3/LICENSE)
    
##### CLI / Library to inspect Internet-Draft documents for a variety of conditions to conform with IETF policies.
    
</div>

> ⚠️ *This branch is for the new JS-based idnits3. For the older shell-based idnits2, [view the v2 branch](https://github.com/ietf-tools/idnits/tree/v2) instead.*

- [Installation](#installation)
- [CLI Usage](#cli-usage)
- [Library Usage](#library-usage)
- [Tests](#tests)
- [Development](#development)
- [Contributing](https://github.com/ietf-tools/.github/blob/main/CONTRIBUTING.md)

---

### Installation

1. Install [Node.js 20.x or later](https://nodejs.org/)
2. Install **idnits** using one of the methods:

#### Globally *(recommended)*

```sh
npm install -g @ietf-tools/idnits
```

#### In an existing npm project

```sh
npm install @ietf-tools/idnits
```

#### Without Installation

```sh
npx @ietf-tools/idnits <args>
```

> [!TIP]
> This is only useful for quickly running the command once without installing. If you plan on using this tool regularly, you should install it globally instead.

### CLI Usage

```sh
idnits [args] <file path|url>
```

| Arguments | Alias | Description | Default |
|---|---|---|---|
| `--datatracker-url` |  | Base URL of the Datatracker used for remote lookups. Overrides the `IDNITS_DATATRACKER_URL` environment variable. | `https://datatracker.ietf.org` |
| `--fail-on` |  | Exit with code `2` if there is at least one nit of the given severity or higher (`errors` > `warnings` > `comments`).<br>Accepted values: `errors`, `warnings`, `comments` |  |
| `--filter` | `-f` | Filter output to only certain severity types. Can be declared multiple times to filter multiple severity types.<br>Accepted values: `errors`, `warnings`, `comments` |  |
| `--mode` | `-m` | Validation mode: the stage of the document's life it is checked for, either `normal` (before RFC publication), `forgive-checklist` (RFC Editor conversion of an approved draft) or `submission` (Internet-Draft submission). See [Validation modes](docs/modes.md).<br>Accepted shorthands: `norm`, `n`, `f-c`, `fc`, `f`, `sub`, `s` | `normal` |
| `--no-color` |  | Disable colors in `pretty` output.<br>No effect in other output formats. |  |
| `--no-progress` |  | Disable progress messages / animations in `pretty` output.<br>No effect in other output formats. |  |
| `--offline` |  | Skip the lookups about the document itself (its stream, its revision, the RFCs it updates or obsoletes). The status of the documents it references is still looked up: see [Remote lookups and `--offline`](docs/modes.md#remote-lookups-and---offline). |  |
| `--output` | `-o` | Output format, must be either `pretty`, `simple`, `json` or `count` | `pretty` |
| `--remote-timeout` |  | Seconds allowed for each remote lookup before it fails. Overrides the `IDNITS_REMOTE_TIMEOUT` environment variable. | `10` |
| `--rfceditor-url` |  | Base URL of the RFC Editor site used for remote lookups. Overrides the `IDNITS_RFCEDITOR_URL` environment variable. | `https://www.rfc-editor.org` |
| `--solarized` |  | Use alternate colors for a solarized light theme terminal.<br>Only used with the `pretty` output format. |  |
| `--help` | `-h` | Print the help text and exit |  |
| `--version` |  | Print the version and exit |  |

#### Validation modes

The mode says at which stage of its life the document is checked, not how strictly: `normal` before RFC publication, `forgive-checklist` when the RFC Editor converts an approved draft into an RFC, and `submission` when an Internet-Draft is uploaded to Datatracker. [Validation modes](docs/modes.md) explains each mode and lists every finding with its severity in each one.

#### Remote lookups

Some validations look up the document and the documents it references on the Datatracker (e.g. its latest revision and stream) and the RFC Editor site (e.g. the status of RFCs). `--offline` skips only some of them: see [Remote lookups and `--offline`](docs/modes.md#remote-lookups-and---offline). The lookups of a document are made once per run, with a `User-Agent` header naming idnits3 and its version (e.g. `idnits3/3.0.0 (+https://github.com/ietf-tools/idnits)`).

The services they are sent to, and the time each lookup is allowed, can be changed with these environment variables, or the matching flags, which take precedence. URLs must be `http` or `https` URLs, a trailing slash is ignored. The timeout is a positive number of seconds; it covers the whole request, response included.

| Environment variable | Flag | Default |
|---|---|---|
| `IDNITS_DATATRACKER_URL` | `--datatracker-url` | `https://datatracker.ietf.org` |
| `IDNITS_RFCEDITOR_URL` | `--rfceditor-url` | `https://www.rfc-editor.org` |
| `IDNITS_REMOTE_TIMEOUT` | `--remote-timeout` | `10` |

A lookup that times out fails like one to a service that can't be reached: a warning naming the host is printed once, and the validations carry on without its result.

The environment variables also apply when idnits is used as a library in Node.js. In the browser, lookups go through the `/idnits3/api/` endpoints of the page's server instead.

> [!NOTE]
> **Datatracker deployments:** when idnits runs next to the Datatracker (e.g. in its celery containers), set `IDNITS_DATATRACKER_URL` to the in-cluster Datatracker web service (e.g. `http://datatracker:8000`), so that the lookups made for each submission stay in the cluster instead of going out through the public internet and its CDN. `IDNITS_REMOTE_TIMEOUT` bounds how long a slow or unresponsive Datatracker can hold up the check of a submission.

#### Exit codes

| Code | Meaning |
|---|---|
| `0` | Validation completed (whatever nits were found, unless `--fail-on` is used) |
| `1` | Validation could not be completed (e.g. the document could not be read or parsed). Datatracker treats any nonzero code this way. |
| `2` | Validation completed and found at least one nit at or above the `--fail-on` severity |

### Library Usage

> [!NOTE]
> The library documentation is a work in progress.

Ensure you installed the library locally to your project (`npm install @ietf-tools/idnits`).

#### Simple Validation Run

Use the `checkNits()` method to quickly run all the validation checks and return a results array.

```js
import { checkNits } from '@ietf-tools/idnits'

const documentRawBuffer = ...
const documentFileName = 'draft-ietf-abcd-efgh-01.xml'

const results = await checkNits(documentRawBuffer, documentFileName)
```

For XML documents, results that have a `path` (e.g. `rfc.middle.section[2].section[1].t[0]`) also get a human-readable `label` describing that location (e.g. `Section 3.2 (Security Considerations), paragraph 1`). The CLI shows it next to the path, and includes it as `label` in the `json` output.

#### Task Runner

You can implement your own task runner to have full control over how the validations are executed. The `getAllValidations()` method returns a list of all validations that should be run.

```js
import { getAllValidations, labelFindings } from '@ietf-tools/idnits'

const ext = filename.endsWith('.xml') ? 'xml' : 'txt'
const result = []
const ctx = {
  raw,
  filename,
  options: {
    allowedDomains,
    mode,
    offline,
    year
  }
}

const validations = getAllValidations(ext)

for (const valGroup of validations) {
  // Skip validation group if condition is not met
  if (valGroup.condition && !valGroup.condition(ctx)) {
    continue
  }

  // Run validations in parallel when possible
  if (valGroup.concurrent) {
    const valGroupResult = await Promise.all(valGroup.tasks.map(valTask => valTask.task(ctx)))
    for (const taskResult of valGroupResult) {
      if (Array.isArray(taskResult)) {
        result.push(...taskResult)
      }
    }
  } else {
    // Run validations sequentially otherwise
    for (const valTask of valGroup.tasks) {
      const taskResult = await valTask.task(ctx)
      if (!valTask.isVoid && Array.isArray(taskResult)) {
        result.push(...taskResult)
      }
    }
  }
}

// Optionally, add human-readable locations to XML results
labelFindings(result, ctx.doc)

return result
```

### Tests

Tests are made using the [Vitest](https://vitest.dev/) library and are located under the `tests` directory.

You can run the suite of tests using:
```sh
# Make sure you installed dependencies first:
npm install

# Run the tests
npm test
```

Code coverage is expected to reach 100%. Ensure this is still the case when making edits / adding new functionality.

### Development

1. Clone the project
2. Run `npm install`
3. Run the CLI: *(replacing `<args>` and `<file path|url>` with the desired flags + file path)*
    ```
    node cli.js <args> <file path|url>
    ```
