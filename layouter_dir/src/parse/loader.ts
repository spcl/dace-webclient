import Parser from "./parser";
import RenderGraph from "../renderGraph/renderGraph";

export default class Loader {
    static load(name): Promise<RenderGraph> {
        return fetch("./graphs/" + name + ".json")
            .then(response => response.json())
            .then(json => Parser.parse(json));
    }
}
