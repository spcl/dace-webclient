This repository hosts the JavaScript side for web and VSCode clients of DaCe and the DIODE.

For more information, see the [DaCe](https://www.github.com/spcl/dace) repository.

Getting started by compiling as you edit the files:

```
npm install
npm run watch
```

Before committing your changes, run `npm install && npm run build-prod` to build a production bundle. GitHub Actions will fail if the production bundle in your commit is not up-to-date. If the CI is failing, make sure that you run `npm install` before building as the dependencies might've changed.
