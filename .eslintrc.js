module.exports = {
    'env': {
        'browser': true,
        'es2021': true
    },
    'extends': [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended'
    ],
    'parser': '@typescript-eslint/parser',
    'parserOptions': {
        'ecmaVersion': 12,
        'sourceType': 'module'
    },
    'plugins': [
        '@typescript-eslint'
    ],
    'ignorePatterns': ['**/*.js'],
    'rules': {
        '@typescript-eslint/no-explicit-any': 'off',
        "@typescript-eslint/no-non-null-assertion": "off",
        "prefer-arrow-callback": "error",
        'indent': [
            'error',
            4,
            {
                'SwitchCase': 1,
            }
        ],
        'linebreak-style': [
            'error',
            'unix'
        ],
        'quotes': [
            'error',
            'single'
        ],
        'semi': [
            'error',
            'always'
        ],
        'prefer-arrow-callback': 'error',
        '@typescript-eslint/no-non-null-assertion': 'off',
        'camelcase': 'error',
        '@typescript-eslint/ban-ts-comment': 'off',
    }
};
