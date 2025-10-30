// This file uses CommonJS require instead of ES6 imports because it is not
// transpiled
const path = require('path');
const webpack = require('webpack');

const coreConfig = {
    module: {
        rules: [
            {
                test: /\.m?[jt]sx?$/,
                use: [
                    'babel-loader',
                    {
                        loader: 'ts-loader',
                        options: {
                            configFile: 'tsconfig-build.json',
                        },
                    },
                ],
                exclude: /node_modules/,
            },
            {
                test: /\.css$/,
                use: [
                    'style-loader',
                    'css-loader',
                ],
            },
            {
                test: /\.(scss)$/,
                use: [
                    'style-loader',
                    'css-loader',
                    'sass-loader',
                ],
            },
            {
                test: /\.(woff|woff2|otf|eot|ttf)$/i,
                type: 'asset/resource',
            },
        ],
    },
    resolve: {
        extensions: ['.ts', '.js'],
        alias: {
            assert: require.resolve('assert'),
            buffer: require.resolve('buffer'),
            stream: require.resolve('stream-browserify'),
            zlib: require.resolve('browserify-zlib'),
        }
    },
    devtool: 'source-map',
    devServer: {
        port: 3000,
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
    plugins: [
        new webpack.ProvidePlugin({
            process: 'process/browser',
        }),
    ]
}

const mainConfig = {
    name: 'main',
    entry: {
        sdfv: './src/web_sdfv.ts',
    },
    ...coreConfig,
};

const jupyterConfig = {
    name: 'jupyter',
    entry: {
        sdfv: './src/web_sdfv.ts',
    },
    module: {
        rules: [
            {
                test: /\.m?[jt]sx?$/,
                use: [
                    'babel-loader',
                    'ts-loader',
                ],
                exclude: /node_modules/,
            },
            {
                test: /\.css$/,
                use: [
                    'style-loader',
                    'css-loader',
                ],
            },
            {
                test: /\.(scss)$/,
                use: [
                    'style-loader',
                    'css-loader',
                    'sass-loader',
                ],
            },
            {
                test: /\.(png|jpe?g|gif|svg|woff|woff2|otf|eot|ttf)(\?.*$|$)/,
                type: 'asset',
            },
        ],
    },
    resolve: {
        extensions: ['.ts', '.js'],
        alias: {
            assert: require.resolve('assert'),
            buffer: require.resolve('buffer'),
            stream: require.resolve('stream-browserify'),
            zlib: require.resolve('browserify-zlib'),
        }
    },
    output: {
        filename: '[name]_jupyter.js',
        path: path.resolve(__dirname, 'dist'),
        publicPath: path.resolve(__dirname, 'dist'),
    },
    plugins: [
        new webpack.ProvidePlugin({
            process: 'process/browser',
        }),
        new webpack.optimize.LimitChunkCountPlugin({
            maxChunks: 1,
        }),
    ]
};

module.exports = [
    mainConfig,
    jupyterConfig,
];
