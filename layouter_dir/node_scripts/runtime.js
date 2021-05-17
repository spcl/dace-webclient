const load = require('./nodeLoader');
require('../dist/layoutLib');
const layouter = new layoutLib.layouter.DagreLayouter();
layoutLib.Bench.runtime(load, layouter).catch((e) => {
    console.error(e);
});
