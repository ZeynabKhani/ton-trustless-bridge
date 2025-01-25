import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    toNano,
} from '@ton/core';
import { Op } from './Constants';

export type LiteClientConfig = {};

export function liteClientConfigToCell(config: LiteClientConfig): Cell {
    return beginCell().endCell();
}

export class LiteClient implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new LiteClient(address);
    }

    static createFromConfig(config: LiteClientConfig, code: Cell, workchain: number) {
        const data = liteClientConfigToCell(config);
        const init = { code, data };
        return new LiteClient(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    // todo: receives from lite-server and builds new_key_block message.
    async sendNewKeyBlock(provider: ContractProvider, via: Sender, params: any) {
        const block: Cell = beginCell().endCell();
        const signatures: Cell = beginCell().endCell();
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Op.new_key_block, 32)
                .storeUint(0, 64)
                .storeRef(block)
                .storeRef(signatures)
                .endCell(),
            value: toNano('0.05'),
        });
    }
}
