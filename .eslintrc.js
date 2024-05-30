module.exports = {
    "env": {
        "browser": true,
        "es2021": true
    },
    "extends": [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended"
    ],
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
        "ecmaVersion": 12,
        "sourceType": "module"
    },
    "plugins": [
        "@typescript-eslint"
    ],
    "ignorePatterns": ["**/*.js"],
    "rules": {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-inferrable-types": "off",
        "@typescript-eslint/no-this-alias": "warn",
        "@typescript-eslint/no-unused-vars": [
            "warn", {
                "argsIgnorePattern": "^_",
            },
        ],
        "@typescript-eslint/no-unsafe-declaration-merging": "warn",
        "@typescript-eslint/no-var-requires": "warn",
        "array-bracket-newline": ["warn", {
            "multiline": true
        }],
        "array-bracket-spacing": ["warn", "never"],
        "array-element-newline": ["warn", "consistent"],
        "arrow-spacing": "warn",
        "block-spacing": ["warn", "always"],
        "brace-style": ["warn", "1tbs"],
        //"camelcase": ["warn"],
        "comma-spacing": "warn",
        "comma-dangle": ["warn", {
            "functions": "never",
            "arrays": "always-multiline",
            "objects": "always-multiline",
            "imports": "always-multiline",
            "exports": "always-multiline"
        }],
        "constructor-super": "warn",
        "curly": ["warn", "multi-or-nest", "consistent"],
        "eol-last": "warn",
        "eqeqeq": "warn",
        "func-call-spacing": ["warn", "never"],
        "function-paren-newline": ["warn", "consistent"],
        "implicit-arrow-linebreak": ["warn", "beside"],
        "indent": ["warn", 4, {
            "SwitchCase": 1
        }],
        "lines-between-class-members": "off",
        "max-len": ["warn", {
            "code": 80,
            "ignoreComments": false,
            "ignoreTrailingComments": false,
            "ignoreUrls": true,
            "ignoreStrings": false,
            "ignoreTemplateLiterals": true,
            "ignoreRegExpLiterals": true
        }],
        "no-case-declarations": "off",
        "no-empty": "off",
        "no-fallthrough": "off",
        "no-throw-literal": "warn",
        "no-trailing-spaces": "warn",
        "no-undef": "off",
        "no-unused-vars": "off",
        "no-useless-escape": "off",
        "no-multiple-empty-lines": "warn",
        "no-nested-ternary": "warn",
        "no-var": "warn",
        "no-whitespace-before-property": "warn",
        "new-parens": ["warn", "always"],
        "nonblock-statement-body-position": ["warn", "below"],
        "object-curly-newline": ["warn", {
            "consistent": true
        }],
        "object-curly-spacing": ["warn", "always"],
        "object-property-newline": ["warn", {
            "allowMultiplePropertiesPerLine": true,
        }],
        "operator-linebreak": ["warn", "after"],
        "padded-blocks": ["warn", {
            "blocks": "never",
            "classes": "always",
            "switches": "never"
        }],
        "prefer-arrow-callback": "error",
        "quotes": ["warn", "single"],
        "semi": "error",
        "space-before-blocks": ["warn", "always"],
        "space-before-function-paren": ["warn", {
            "anonymous": "always",
            "named": "never",
            "asyncArrow": "always"
        }],
        "space-in-parens": ["warn", "never"],
    },
};
