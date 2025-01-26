import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    Slice,
    toNano,
} from '@ton/core';
import { getRepr } from '@ton/core/dist/boc/cell/descriptor';
import { Op } from './Constants';
import { liteServer_BlockData } from 'ton-lite-client/dist/schema';
import { liteServer_blockHeader } from 'ton-lite-client/dist/schema';
import TonRocks from '@oraichain/tonbridge-utils';
import { assert } from 'node:console';
import { LevelMask } from '@ton/core/dist/boc/cell/LevelMask';
import { sha256_sync } from '@ton/crypto';

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
    async sendNewKeyBlock(
        provider: ContractProvider,
        via: Sender,
        blockHeader: liteServer_blockHeader,
        block: liteServer_BlockData,
    ) {
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

        // const magic = rootCell.asSlice().loadUint(32); // 0x11ef55aa
        // const globalId = rootCell.asSlice().loadInt(32);
        // const info = rootCell.asSlice().loadMaybeRef();
        // const valueFlow = rootCell.asSlice().loadMaybeRef();
        // const stateUpdate = rootCell.asSlice().loadMaybeRef();
        // const extra = rootCell.asSlice().loadMaybeRef();

        const blockCell = beginCell().storeRef(blockHeaderCell).storeRef(blockDataCell).endCell();

        const signatures: Cell = beginCell().endCell();
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Op.new_key_block, 32)
                .storeUint(0, 64)
                .storeRef(blockCell)
                // .storeRef(signatures)
                .endCell(),
            value: toNano('0.05'),
        });
    }
}
