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
        "semi": "error",
        "no-useless-escape": "off",
        "prefer-arrow-callback": "error",
        "no-empty": "off",
    }
};
