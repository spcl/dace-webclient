import { SDFGData } from '../../../../utils/sdfg/types';
import { SymbolResolver } from '../../../../utils/symbol_resolver';
import { RendererSettings } from '../../pixi_renderer';
import { CompleteLayout } from '../layout';

export type RenderLayouter = {
    layout(sdfg: SDFGData, settings: RendererSettings, symbolResolver: SymbolResolver): CompleteLayout,
};
