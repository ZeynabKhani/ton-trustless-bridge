import { ValidatorSignature } from '@oraichain/tonbridge-utils';
import { beginCell, Dictionary } from '@ton/core';

import { Cell } from '@ton/core';
import { liteServer_blockHeader } from 'ton-lite-client/dist/schema';

export function createPrunedBranch(cell: Cell): Cell {
    const prunedCell = new Cell({
        exotic: true,
        bits: beginCell()
            .storeUint(1, 8) // type
            .storeUint(1, 8) // level mask
            .storeBuffer(cell.hash(0)) // hash
            .storeUint(cell.depth(0), 16) // depth
            .endCell().bits,
        refs: [],
    });
    return prunedCell;
}

export function pruneExceptBlockInfo(blockData: Cell): Cell {
    // We keep the first 64 bits (magic + global_id) and the info cell reference
    // but prune value_flow and state_update and extra
    const c = blockData;
    const cs = c.beginParse();
    const magic = cs.loadUint(32);
    const globalId = cs.loadInt(32);
    const info = cs.loadRef();

    const valueFlow = cs.loadRef();
    const stateUpdate = cs.loadRef();
    const extra = cs.loadRef();
    const prunedValueFlow = createPrunedBranch(valueFlow);
    const prunedStateUpdate = createPrunedBranch(stateUpdate);
    const prunedExtra = createPrunedBranch(extra);

    const merkleProofRef = beginCell()
        .storeUint(magic, 32)
        .storeInt(globalId, 32)
        .storeRef(info)
        .storeRef(prunedValueFlow)
        .storeRef(prunedStateUpdate)
        .storeRef(prunedExtra)
        .endCell();

    // Reconstruct the cell with pruned branches
    const dataProofCell = new Cell({
        exotic: true,
        bits: beginCell()
            .storeUint(3, 8) // type
            .storeBuffer(c.hash(0)) // hash
            .storeUint(c.depth(0), 16) // depth
            .endCell().bits,
        refs: [merkleProofRef],
    });
    return dataProofCell;
}

export function pruneExceptBlockInfoAndMcBlockExtraConfigParams(blockData: Cell, workchain: number): Cell {
    // We keep the first 64 bits (magic + global_id) and the info cell reference
    // but prune value_flow and state_update and extra
    const c = blockData;
    const cs = c.beginParse();
    const magic = cs.loadUint(32);
    const globalId = cs.loadInt(32);
    const info = cs.loadRef();

    const valueFlow = cs.loadRef();
    const stateUpdate = cs.loadRef();
    const prunedValueFlow = createPrunedBranch(valueFlow);
    const prunedStateUpdate = createPrunedBranch(stateUpdate);

    const extra = cs.loadRef();
    const extraCell = extra;
    const extraSlice = extraCell.beginParse();
    const extraMagic = extraSlice.loadUint(32);
    const randSeed = extraSlice.loadUintBig(256);
    const createdBy = extraSlice.loadUintBig(256);
    const inMsgs = extraSlice.loadRef();
    const outMsgs = extraSlice.loadRef();
    const accountBlocks = extraSlice.loadRef();
    const prunedInMsgs = createPrunedBranch(inMsgs);
    const prunedOutMsgs = createPrunedBranch(outMsgs);
    const prunedAccountBlocks = createPrunedBranch(accountBlocks);

    const mcBlockExtra = extraSlice.loadRef();
    const mcBlockExtraCell = mcBlockExtra;
    const mcBlockExtraSlice = mcBlockExtraCell.beginParse();
    const mcBlockExtraMagic = mcBlockExtraSlice.loadUint(16);
    const isKeyBlock = mcBlockExtraSlice.loadUint(1);

    if (workchain == 0) {
        const shardHashes = mcBlockExtraSlice.loadRef();
        const shardFees = mcBlockExtraSlice.loadRef();
        const additionalData = mcBlockExtraSlice.loadRef();
        const prunedShardHashes = createPrunedBranch(shardHashes);
        const prunedShardFees = createPrunedBranch(shardFees);
        const prunedAdditionalData = createPrunedBranch(additionalData);
        const config = mcBlockExtraSlice.loadRef(); // config param dictionary

        const remainingBits = mcBlockExtraSlice.remainingBits;
        const mcBlockExtraRef = beginCell()
            .storeUint(mcBlockExtraMagic, 16)
            .storeUint(isKeyBlock, 1)
            .storeRef(prunedShardHashes)
            .storeRef(prunedShardFees)
            .storeRef(prunedAdditionalData)
            .storeRef(config)
            .storeUint(mcBlockExtraSlice.loadUintBig(remainingBits - 256), remainingBits - 256)
            .storeUint(mcBlockExtraSlice.loadUintBig(256), 256)
            .endCell();

        const extraRemainingBits = extraSlice.remainingBits;
        const extraRef = beginCell()
            .storeUint(extraMagic, 32)
            .storeUint(randSeed, 256)
            .storeUint(createdBy, 256)
            .storeUint(extraSlice.loadUint(extraRemainingBits), extraRemainingBits)
            .storeRef(prunedInMsgs)
            .storeRef(prunedOutMsgs)
            .storeRef(prunedAccountBlocks)
            .storeRef(mcBlockExtraRef)
            .endCell();

        const merkleProofRef = beginCell()
            .storeUint(magic, 32)
            .storeInt(globalId, 32)
            .storeRef(info)
            .storeRef(prunedValueFlow)
            .storeRef(prunedStateUpdate)
            .storeRef(extraRef)
            .endCell();

        // Reconstruct the cell with pruned branches
        const dataProofCell = new Cell({
            exotic: true,
            bits: beginCell()
                .storeUint(3, 8) // type
                .storeBuffer(c.hash(0)) // hash
                .storeUint(c.depth(0), 16) // depth
                .endCell().bits,
            refs: [merkleProofRef],
        });
        return dataProofCell;
    } else if (workchain == -1) {
        // const shardHashes = mcBlockExtraSlice.loadRef();
        // const shardFees = mcBlockExtraSlice.loadRef();
        const additionalData = mcBlockExtraSlice.loadRef();
        // const prunedShardHashes = LiteClient.createPrunedBranch(shardHashes);
        // const prunedShardFees = LiteClient.createPrunedBranch(shardFees);
        const prunedAdditionalData = createPrunedBranch(additionalData);
        const remainingBits = mcBlockExtraSlice.remainingBits;
        const remainingBits1 = mcBlockExtraSlice.loadUintBig(remainingBits - 256);
        const remainingBits2 = mcBlockExtraSlice.loadUintBig(256);
        const config = mcBlockExtraSlice.loadRef(); // config param dictionary

        const mcBlockExtraRef = beginCell()
            .storeUint(mcBlockExtraMagic, 16)
            .storeUint(isKeyBlock, 1)
            // .storeRef(prunedShardHashes)
            // .storeRef(prunedShardFees)
            .storeUint(remainingBits1, remainingBits - 256)
            .storeUint(remainingBits2, 256)
            .storeRef(prunedAdditionalData)
            .storeRef(config)
            .endCell();

        const extraRemainingBits = extraSlice.remainingBits;
        const extraRef = beginCell()
            .storeUint(extraMagic, 32)
            .storeUint(randSeed, 256)
            .storeUint(createdBy, 256)
            .storeUint(extraSlice.loadUint(extraRemainingBits), extraRemainingBits)
            .storeRef(prunedInMsgs)
            .storeRef(prunedOutMsgs)
            .storeRef(prunedAccountBlocks)
            .storeRef(mcBlockExtraRef)
            .endCell();

        const merkleProofRef = beginCell()
            .storeUint(magic, 32)
            .storeInt(globalId, 32)
            .storeRef(info)
            .storeRef(prunedValueFlow)
            .storeRef(prunedStateUpdate)
            .storeRef(extraRef)
            .endCell();

        // Reconstruct the cell with pruned branches
        const dataProofCell = new Cell({
            exotic: true,
            bits: beginCell()
                .storeUint(3, 8) // type
                .storeBuffer(c.hash(0)) // hash
                .storeUint(c.depth(0), 16) // depth
                .endCell().bits,
            refs: [merkleProofRef],
        });
        return dataProofCell;
    }
    return beginCell().endCell();
}

export function createBlockHeaderCell(blockHeader: liteServer_blockHeader): Cell {
    const blockHeaderIdCell = beginCell()
        // .storeInt(0x6752eb78, 32) // tonNode.blockIdExt
        .storeInt(blockHeader.id.workchain, 32)
        // .storeInt(BigInt(blockHeader.id.shard), 64)
        .storeInt(blockHeader.id.seqno, 32)
        .storeUint(BigInt('0x' + Buffer.from(blockHeader.id.rootHash).toString('hex')), 256)
        .storeUint(BigInt('0x' + Buffer.from(blockHeader.id.fileHash).toString('hex')), 256)
        .endCell();
    const blockHeaderCell = beginCell()
        // .storeInt(0x752d8219, 32) // kind: liteServer.blockHeader
        .storeRef(blockHeaderIdCell) // id
        // .storeUint(blockHeader.mode, 32) // mode
        .storeRef(Cell.fromBoc(Buffer.from(blockHeader.headerProof))[0]) // header_proof
        .endCell();
    return blockHeaderCell;
}

export function createSignatureCell(signatures: ValidatorSignature[]) {
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
