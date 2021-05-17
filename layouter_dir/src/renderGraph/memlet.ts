import RenderEdge from "./renderEdge";

export default class Memlet extends RenderEdge {
    label(): string {
        if (!this.attributes.subset) {
            return "";
        }
        let label = this.attributes.data || "";
        const subset = this.sdfgPropertyToString(this.attributes.subset);
        label += (subset.length <= 3 ? subset : "[...]");
        if (this.attributes.other_subset) {
            const otherSubset = this.sdfgPropertyToString(this.attributes.other_subset);
            label += ' -> ' + (otherSubset.length <= 3 ? otherSubset : "[...]");
        }
        if (this.attributes.wcr) {
            label += "\n" + 'CR: ' + this.sdfgPropertyToString(this.attributes.wcr);
        }
        return label;
    }
}
