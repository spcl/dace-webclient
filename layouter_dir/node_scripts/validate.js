const load = require('./nodeLoader');
require('../dist/layoutLib');
const layouter = new layoutLib.layouter.SugiyamaLayouter({shuffles: 16, shuffleGlobal: false, preorderConnectors: true, bundle: true});
layoutLib.Bench.validate(load, layouter, layoutLib.Bench.GRAPHS_ALL).catch((e) => {
    console.error(e);
});
