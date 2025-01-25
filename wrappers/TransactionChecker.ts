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

export type transactionCheckerConfig = {};

export function transactionCheckerConfigToCell(config: transactionCheckerConfig): Cell {
    return beginCell().endCell();
}

export class TransactionChecker implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new TransactionChecker(address);
    }

    static createFromConfig(config: transactionCheckerConfig, code: Cell, workchain: number) {
        const data = transactionCheckerConfigToCell(config);
        const init = { code, data };
        return new TransactionChecker(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    // todo: receives data from lite-server and builds check_transaction message for any given transaction in Masterchain.

    async sendNewKeyBlock(provider: ContractProvider, via: Sender, params: any) {
        const transaction: Cell = beginCell().endCell();
        const proof: Cell = beginCell().endCell();
        const current_block: Cell = beginCell().endCell();
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Op.check_transaction, 32)
                .storeRef(transaction)
                .storeRef(proof)
                .storeRef(current_block)
                .endCell(),
            value: toNano('0.05'),
        });
    }
}
