require('lodash');
require('../dist/layoutLib');

module.exports = (name) => {
    const path = require('path');
    const url = path.resolve(__dirname, "../graphs/" + name + ".json");
    const json = require(url);
    const graph = layoutLib.Parser.parse(json);
    // set node sizes
    _.forEach(graph.allNodes(), (node) => {
        node.updateSize({width: 100, height: 34});
    });

    return new Promise(resolve => {
        resolve(graph);
    });
}