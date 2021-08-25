import Node from '../graph/node';
import OrderGroup from './orderGroup';

export default class OrderNode extends Node<any, any>
{
    public reference: any;
    public group: OrderGroup;
    public position = 0;
    public index = 0; // the index within the group, used as an id, changes only when another node is removed
    public rank = 0;
    public readonly isVirtual: boolean;

    constructor(reference: any, isVirtual: boolean, label = '') {
        super(label);
        this.reference = reference;
        this.isVirtual = isVirtual;
    }
}
