// This file uses CommonJS require instead of ES6 imports because it is not transpiled
const path = require('path');

module.exports = {
    plugins: {
    },
    entry: {
        sdfv: './src/sdfv.ts',
    },
    module: {
        rules: [
            {
                test: /\.m?[jt]sx?$/,
                use: [
                    {
                        loader: 'babel-loader',
                    },
                    {
                        loader: 'ts-loader',
                    },
                ],
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: ['.ts', '.js'],
        alias: {
            fs: 'pdfkit/js/virtual-fs.js',
        },
        fallback: {
            stream: require.resolve('stream-browserify'),
            util: require.resolve('util/'),
            buffer: require.resolve('buffer/'),
            zlib: require.resolve('browserify-zlib'),
            assert: false,
        },
    },
    devtool: 'source-map',
    devServer: {
        static: {
            directory: __dirname,
        },
        devMiddleware: {
            writeToDisk: true,
        },
    },
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
    },
};
