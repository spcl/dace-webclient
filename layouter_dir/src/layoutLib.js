module.exports = {
    Bench: require('./bench/bench').default,
    Loader: require('./parse/loader').default,
    Parser: require('./parse/parser').default,
    RenderGraph: require('./renderGraph/renderGraph').default,
    layouter: {
        DagreLayouter: require('./layouter/dagreLayouter').default,
        MagneticSpringLayouter: require('./layouter/magneticSpringLayouter').default,
        SugiyamaLayouter: require('./layouter/sugiyamaLayouter').default,
    },
    util: {
        Serializer: require('./util/serializer').default
    }
};
