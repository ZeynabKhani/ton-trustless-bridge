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
    queries_cnt: bigint;
};

export function transactionCheckerConfigToCell(config: transactionCheckerConfig): Cell {
    return beginCell().storeAddress(config.lite_client).storeDict().storeUint(config.queries_cnt, 256).endCell();
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

    static parseProof = (txWithProof: any) => {
        const txProofIdCell = beginCell()
            .storeInt(0x6752eb78, 32) // tonNode.blockIdExt
            .storeInt(txWithProof.id.workchain, 32)
            .storeInt(BigInt(txWithProof.id.shard), 64)
            .storeInt(txWithProof.id.seqno, 32)
            .storeUint(BigInt('0x' + Buffer.from(txWithProof.id.rootHash).toString('hex')), 256)
            .storeUint(BigInt('0x' + Buffer.from(txWithProof.id.fileHash).toString('hex')), 256)
            .endCell();
        const txProofCell = beginCell()
            .storeInt(0xedeed47, 32) // kind: liteServer.transactionInfo TODO
            .storeRef(txProofIdCell) // id
            .storeRef(Cell.fromBoc(Buffer.from(txWithProof.proof))[0]) // proof
            .storeRef(beginCell().endCell()) // transaction
            .endCell();

        return txProofCell;
    };

    static create_block_cell = (blockHeader: liteServer_blockHeader, block: liteServer_BlockData) => {
        const blockHeaderIdCell = beginCell()
            .storeInt(0x6752eb78, 32) // tonNode.blockIdExt
            .storeInt(blockHeader.id.workchain, 32)
            .storeInt(BigInt(blockHeader.id.shard), 64)
            .storeInt(blockHeader.id.seqno, 32)
            .storeUint(BigInt('0x' + Buffer.from(blockHeader.id.rootHash).toString('hex')), 256)
            .storeUint(BigInt('0x' + Buffer.from(blockHeader.id.fileHash).toString('hex')), 256)
            .endCell();
        const blockHeaderCell = beginCell()
            .storeInt(0x752d8219, 32) // kind: liteServer.blockHeader
            .storeRef(blockHeaderIdCell) // id
            .storeUint(blockHeader.mode, 32) // mode
            .storeRef(Cell.fromBoc(Buffer.from(blockHeader.headerProof))[0]) // header_proof
            .endCell();

        const blockDataIdCell = beginCell()
            .storeInt(0x6752eb78, 32) // tonNode.blockIdExt
            .storeInt(block.id.workchain, 32)
            .storeInt(BigInt(block.id.shard), 64)
            .storeInt(block.id.seqno, 32)
            .storeUint(BigInt('0x' + Buffer.from(block.id.rootHash).toString('hex')), 256)
            .storeUint(BigInt('0x' + Buffer.from(block.id.fileHash).toString('hex')), 256)
            .endCell();
        const blockDataCell = beginCell()
            .storeInt(0x6377cf0d, 32) // liteServer.getBlock
            .storeRef(blockDataIdCell)
            .storeRef(Cell.fromBoc(Buffer.from(block.data))[0])
            .endCell();

        const blockCell = beginCell().storeRef(blockHeaderCell).storeRef(blockDataCell).endCell();
        return blockCell;
    };

    static create_signature_cell = (signatures: ValidatorSignature[]) => {
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
    };

    static checkTransactionMessage(
        txWithProof: any,
        blockHeader: liteServer_blockHeader,
        block: liteServer_BlockData,
        signatures: ValidatorSignature[],
    ) {
        const proof: Cell = Cell.fromBoc(Buffer.from(txWithProof.proof))[0];
        const transaction: Cell = Cell.fromBoc(Buffer.from(txWithProof.transaction))[0]
        const aggregatedBlock = TransactionChecker.create_block_cell(blockHeader, block);
        const current_block: Cell = beginCell()
            .storeRef(aggregatedBlock)
            .storeDict(TransactionChecker.create_signature_cell(signatures))
            .endCell();
        const message = beginCell()
            .storeUint(Op.check_transaction, 32)
            .storeUint(0, 64)
            .storeRef(transaction) 
            .storeRef(proof) 
            .storeRef(current_block)
            .endCell();
        return message;
    }

    async sendCheckTransaction(
        provider: ContractProvider,
        via: Sender,
        txWithProof: any,
        blockHeader: liteServer_blockHeader,
        block: liteServer_BlockData,
        signatures: ValidatorSignature[],
        workchain: number,
        value: bigint,
    ) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: TransactionChecker.checkTransactionMessage(txWithProof, blockHeader, block, signatures),
            value: value,
        });
    }

    async sendCorrect(provider: ContractProvider, via: Sender) {
        await provider.internal(via, {
            value: toNano('0.5'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(Op.correct, 32).storeUint(0, 64).storeRef(beginCell().endCell()).endCell(),
        });
    }

    async sendReject(provider: ContractProvider, via: Sender) {
        await provider.internal(via, {
            value: toNano('0.5'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(Op.reject, 32).storeUint(0, 64).storeRef(beginCell().endCell()).endCell(),
        });
    }

    async sendRandomOpcode(provider: ContractProvider, via: Sender) {
        await provider.internal(via, {
            value: toNano('0.5'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0x123, 32).storeUint(0, 64).endCell(),
        });
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
