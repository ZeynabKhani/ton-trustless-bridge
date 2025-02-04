import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    DictionaryKey,
    DictionaryKeyTypes,
    DictionaryValue,
    Sender,
    SendMode,
    Slice,
    toNano,
} from '@ton/core';
import { Op } from './Constants';
import { LiteClient } from 'ton-lite-client';
import { liteServer_BlockData, liteServer_blockHeader } from 'ton-lite-client/dist/schema';
import { ValidatorSignature } from '@oraichain/tonbridge-utils';

export type transactionCheckerConfig = {
    lite_client: Address;
    query_id: number;
    check_transaction_requests: Cell;
};

export function transactionCheckerConfigToCell(config: transactionCheckerConfig): Cell {
    return beginCell().storeAddress(config.lite_client).storeUint(config.query_id, 256).storeDict().endCell();
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

    static createSignatureCell(signatures: ValidatorSignature[]) {
        let signaturesCell = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
        for (const item of signatures) {
            const signature = Buffer.from(item.signature, 'base64').toString('hex');
            const signaturePart1 = BigInt('0x' + signature.substring(0, 64));
            const signaturePart2 = BigInt('0x' + signature.substring(64));
            signaturesCell.set(
                BigInt('0x' + Buffer.from(item.node_id_short, 'base64').toString('hex')),
                beginCell().storeUint(signaturePart1, 256).storeUint(signaturePart2, 256).endCell(),
            );
        }
        return signaturesCell;
    }

    static checkTransactionMessage(txWithProof: any, signatures: ValidatorSignature[]) {
        const currentBlock: Cell = beginCell()
            .storeRef(Cell.fromBoc(Buffer.from(txWithProof.proof))[0])
            .storeDict(this.createSignatureCell(signatures))
            .endCell();
        const blockHeaderIdCell = beginCell()
            .storeInt(0x6752eb78, 32) // tonNode.blockIdExt
            .storeInt(txWithProof.blockId.workchain, 32)
            .storeInt(BigInt(txWithProof.blockId.shard), 64)
            .storeInt(txWithProof.blockId.seqno, 32)
            .storeUint(BigInt('0x' + Buffer.from(txWithProof.blockId.rootHash).toString('hex')), 256)
            .storeUint(BigInt('0x' + Buffer.from(txWithProof.blockId.fileHash).toString('hex')), 256)
            .endCell();
        const proof = beginCell()
            .storeRef(blockHeaderIdCell)
            .storeRef(Cell.fromBoc(Buffer.from(txWithProof.proof))[0])
            .endCell();
        const message = beginCell()
            .storeUint(Op.check_transaction, 32)
            .storeRef(Cell.fromBoc(Buffer.from(txWithProof.transaction))[0])
            .storeRef(proof)
            .storeRef(currentBlock)
            .endCell();
        return message;
    }

    async sendCheckTransaction(
        provider: ContractProvider,
        via: Sender,
        txWithProof: any,
        signatures: ValidatorSignature[],
        workchain: number,
        value: bigint,
    ) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: TransactionChecker.checkTransactionMessage(txWithProof, signatures),
            value: value,
        });
        console.log('TransactionChecker.sendCheckTransaction');
    }

    async getKey(provider: ContractProvider, key: bigint) {
        const res = await provider.get('get_key', [{ type: 'int', value: key }]);
        let address;
        try {
            address = res.stack.readAddress();
        } catch (e) {
            address = '0';
        }
        return address;
    }
}
