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
import { LiteRoundRobinEngine } from '../ton-lite-client/dist';
import { liteServer_BlockData, liteServer_blockHeader } from 'ton-lite-client/dist/schema';
import { ValidatorSignature } from '@oraichain/tonbridge-utils';

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
    async sendCheckTransaction(
        provider: ContractProvider, 
        via: Sender, 
        txWithProof: any, 
        blockHeader: liteServer_blockHeader,
        block: liteServer_BlockData,
        signatures: ValidatorSignature[],
    ) {
        // const transaction: Cell = beginCell().storeSlice(txHash).storeSlice(rootHash).endCell();
        const proof: Cell = Cell.fromBoc(Buffer.from(txWithProof.proof))[0]
        const aggregatedBlock = this.create_block_cell(blockHeader, block)
        const signature = this.create_signature_cell(signatures);
        const current_block: Cell = beginCell().storeRef(aggregatedBlock).storeRef(signature).endCell();
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Op.check_transaction, 32)
                .storeUint(0, 64)
                .storeRef(beginCell().endCell()) //transaction todo put txhash and account block 
                .storeRef(proof) // proof
                .storeRef(current_block)
                .endCell(),
            value: toNano('0.05'),
        });
    }

    create_signature_cell = (signatures: ValidatorSignature[]) => {
        return beginCell().endCell();
        // let signaturesCell = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
        //     for (const item of signatures) {
        //         const signature = Buffer.from(item.signature, 'base64').toString('hex');
        //         const signaturePart1 = BigInt('0x' + signature.substring(0, 64));
        //         const signaturePart2 = BigInt('0x' + signature.substring(64));
        //         signaturesCell.set(
        //             BigInt('0x' + Buffer.from(item.node_id_short, 'base64').toString('hex')),
        //             beginCell().storeUint(signaturePart1, 256).storeUint(signaturePart2, 256).endCell(),
        //         );
        //     }
    }

    create_block_cell = (blockHeader: liteServer_blockHeader, block: liteServer_BlockData) => {
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
    }

    parseProof = (txWithProof: any) => {
        const txProofIdCell = beginCell()
            .storeInt(0x6752eb78, 32) // tonNode.blockIdExt
            .storeInt(txWithProof.id.workchain, 32)
            .storeInt(BigInt(txWithProof.id.shard), 64)
            .storeInt(txWithProof.id.seqno, 32)
            .storeUint(BigInt('0x' + Buffer.from(txWithProof.id.rootHash).toString('hex')), 256)
            .storeUint(BigInt('0x' + Buffer.from(txWithProof.id.fileHash).toString('hex')), 256)
            .endCell();
        const txProofCell = beginCell()
            .storeInt(0xEDEED47, 32) // kind: liteServer.transactionInfo TODO
            .storeRef(txProofIdCell) // id
            .storeRef((Cell.fromBoc(Buffer.from(txWithProof.proof))[0])) // proof
            .storeRef(beginCell().endCell()) // transaction
            .endCell();

        return txProofCell
    }
}
