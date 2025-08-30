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

1. Install [Node.js 18.x or later](https://nodejs.org/)
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
| `--filter` | `-f` | Filter output to only certain severity types. Can be declared multiple times to filter multiple severity types.<br>Accepted values: `errors`, `warnings`, `comments` |  |
| `--mode` | `-m` | Validation mode, must be either `normal`, `forgive-checklist` or `submission`<br>Accepted shorthands: `norm`, `n`, `f-c`, `fc`, `f`, `sub`, `s` | `normal` |
| `--no-color` |  | Disable colors in `pretty` output.<br>No effect in other output formats. |  |
| `--no-progress` |  | Disable progress messages / animations in `pretty` output.<br>No effect in other output formats. |  |
| `--offline` |  | Disable validations that require an internet connection. |  |
| `--output` | `-o` | Output format, must be either `pretty`, `simple`, `json` or `count` | `pretty` |
| `--solarized` |  | Use alternate colors for a solarized light theme terminal.<br>Only used with the `pretty` output format. |  |
| `--year` | `-y` | Expect the given year in the boilerplate |  |
| `--help` | `-h` | Print the help text and exit |  |
| `--version` |  | Print the version and exit |  |

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

#### Task Runner

You can implement your own task runner to have full control over how the validations are executed. The `getAllValidations()` method returns a list of all validations that should be run.

```js
import { getAllValidations } from '@ietf-tools/idnits'

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
