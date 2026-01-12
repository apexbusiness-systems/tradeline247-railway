module.exports = {
    env: {
        node: true,
        es2022: true,
    },
    extends: 'airbnb-base',
    rules: {
        'no-console': 'off',
        'consistent-return': 'error',
        'no-underscore-dangle': 'off',
        'class-methods-use-this': 'off',
        'import/no-extraneous-dependencies': 'off',
    },
};
