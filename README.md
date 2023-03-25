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
  - [As a CLI](#as-a-cli)
  - [As a library](#as-a-library)
- [Tests](#tests)
- [Development](#development)
- [Contributing](https://github.com/ietf-tools/.github/blob/main/CONTRIBUTING.md)

---

### Installation

1. Install [Node.js 18.x or later](https://nodejs.org/)
2. Install idnits:

```sh
npm install -g @ietf-tools/idnits
```

### Usage

#### As a CLI

```sh
idnits [args] <file>
```

| Arguments | Alias | Description | Default |
|---|---|---|---|
| `--version` |  | Print the version and exit |  |
| `--help` | `-h` | Print the help text and exit |  |
| `--mode` | `-m` | Validation mode, must be either `normal`, `forgive-checklist` or `submission`<br>Accepted shorthands: `norm`, `n`, `f-c`, `fc`, `f`, `sub`, `s` | `normal` |
| `--output` | `-o` | Output format, must be either `pretty`, `json` or `count` | `pretty` |
| `--year` | `-y` | Expect the given year in the boilerplate |  |

#### As a library

*TODO*

### Tests

Tests are made using the [Jest](https://jestjs.io/) library and are located under the `tests` directory.

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
3. Run the CLI using `node cli.js <args>` (replacing `<args>` with the flags + file path)
