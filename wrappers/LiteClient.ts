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
import crypto from 'crypto';
import { getRepr } from '@ton/core/dist/boc/cell/descriptor';
import { Op } from './Constants';
import { liteServer_BlockData } from 'ton-lite-client/dist/schema';
import { liteServer_blockHeader } from 'ton-lite-client/dist/schema';
import TonRocks, { pubkeyHexToEd25519DER } from '@oraichain/tonbridge-utils';
import { assert } from 'node:console';
import { LevelMask } from '@ton/core/dist/boc/cell/LevelMask';
import { sha256, sha256_sync } from '@ton/crypto';
import { BitString, ValidatorSignature } from '@oraichain/tonbridge-utils/build/types';
import { HexBinary } from '@oraichain/tonbridge-contracts-sdk/build/types';
import { loadBlockInfo } from '@oraichain/tonbridge-utils/build/blockchain/BlockParser';

export type LiteClientConfig = {};

export function liteClientConfigToCell(config: LiteClientConfig): Cell {
    return beginCell().endCell();
}

interface SigPubKey {
    _: 'SigPubKey';
    pubkey: any;
}

interface ValidatorDescr {
    _: 'ValidatorDescr';
    type: any;
    public_key: SigPubKey;
    weight: any;
    adnl_addr: any;
}

interface UserFriendlyValidator extends ValidatorDescr {
    node_id: string;
    pubkey: string;
}

function loadSigPubKey(s: Slice): SigPubKey {
    let data: SigPubKey = { _: 'SigPubKey', pubkey: BigInt(0) };
    if (s.loadUint(32) !== 0x8e81278a) throw Error('not a SigPubKey');
    data.pubkey = s.loadUintBig(256);
    return data;
}

function loadValidatorDescr(s: Slice): ValidatorDescr | null {
    let data: ValidatorDescr = {
        _: 'ValidatorDescr',
        type: '',
        public_key: { _: 'SigPubKey', pubkey: BigInt(0) },
        weight: 0,
        adnl_addr: BigInt(0),
    };
    let type = s.loadUint(8);
    if (type === 0x53) {
        data.type = '';
        data.public_key = loadSigPubKey(s);
        data.weight = Number(s.loadUintBig(64));
        return data;
    } else if (type === 0x73) {
        data.type = 'addr';
        data.public_key = loadSigPubKey(s);
        data.weight = Number(s.loadUintBig(64));
        data.adnl_addr = s.loadUintBig(256);
        return data;
    }
    throw Error('not a ValidatorDescr');
}

function ValidatorDescrValue(): DictionaryValue<ValidatorDescr> {
    return {
        serialize: (src: ValidatorDescr) => {
            throw new Error('Serialization not implemented');
        },
        parse: (src: Slice) => {
            const result = loadValidatorDescr(src);
            if (result === null) throw new Error('Failed to parse ValidatorDescr');
            return result;
        },
    };
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

    static async testBlockData(blockDataCell: Cell, signatures: ValidatorSignature[], message: Buffer) {
        const testBlockDataCell = blockDataCell.beginParse();
        testBlockDataCell.loadInt(32);
        testBlockDataCell.loadRef();
        const data = testBlockDataCell.loadRef().beginParse();
        data.loadUint(32);
        data.loadInt(32); // global_id
        const info = data.loadRef();
        data.loadRef();
        data.loadRef();
        const extra = data.loadRef().beginParse();
        extra.loadUint(32);
        extra.loadRef();
        extra.loadRef();
        extra.loadRef();
        extra.loadUintBig(256);
        extra.loadUintBig(256); // created_by
        const McBlockExtra = extra.loadRef().beginParse(); // or custom
        McBlockExtra.loadUint(16); // magic cca5
        const key_block = McBlockExtra.loadBit();

        McBlockExtra.loadRef(); // shard_hashes
        McBlockExtra.loadRef(); // shard_fees
        McBlockExtra.loadRef(); // additional_info

        let validatorSet: Dictionary<number, ValidatorDescr> | null = null;
        if (key_block) {
            let configParamsCell = McBlockExtra.loadDict(Dictionary.Keys.Uint(32), Dictionary.Values.Cell());
            McBlockExtra.loadBits(75); // not sure what this is
            McBlockExtra.loadBits(256); // config_address

            let configParam34 = configParamsCell.get(34)!.beginParse();

            const type = configParam34.loadUint(8);
            if (type === 0x11) {
                const utime_since = configParam34?.loadUint(32);
                const utime_until = configParam34?.loadUint(32);
                const total = configParam34?.loadUint(16);
                const main = configParam34?.loadUint(16);
                if (total! < main!) throw Error('data.total < data.main');
                if (main! < 1) throw Error('data.main < 1');
                validatorSet = configParam34?.loadDict(Dictionary.Keys.Uint(16), ValidatorDescrValue());
                // console.log(type, utime_since, utime_until, total, main, list);
            } else if (type === 0x12) {
                // type = 'ext';
                const utime_since = configParam34.loadUint(32);
                const utime_until = configParam34.loadUint(32);
                const total = configParam34.loadUint(16);
                const main = configParam34.loadUint(16);
                if (total! < main!) throw Error('data.total < data.main');
                if (main! < 1) throw Error('data.main < 1');
                const total_weight = configParam34.loadUintBig(64);
                validatorSet = configParam34.loadDict(Dictionary.Keys.Uint(16), ValidatorDescrValue());
                // console.log(type, utime_since, utime_until, total, main, total_weight, list);
            }

            let sumLargestTotalWeights = 0;
            for (const [_, validator] of validatorSet!) {
                sumLargestTotalWeights += Number(validator.weight);
            }

            let friendlyValidators: UserFriendlyValidator[] = [];
            for (const entry of validatorSet!) {
                // magic number prefix for a node id of a validator
                const nodeIdPrefix = Buffer.from([0xc6, 0xb4, 0x13, 0x48]);
                const pubkey = entry[1].public_key.pubkey;
                // Convert BigInt pubkey to hex string, pad to 64 chars, then convert to Buffer
                const pubkeyBuffer = Buffer.from(pubkey.toString(16).padStart(64, '0'), 'hex');
                // Now concatenate the buffers
                const nodeId = await sha256(Buffer.concat([nodeIdPrefix, pubkeyBuffer]));
                friendlyValidators.push({
                    ...entry[1],
                    node_id: nodeId.toString('base64'),
                    weight: +entry[1].weight.toString(),
                    pubkey,
                });
            }

            let totalWeight = 0;
            for (const item of signatures) {
                for (const validator of friendlyValidators) {
                    if (validator.node_id === item.node_id_short) {
                        const key = pubkeyHexToEd25519DER(BigInt(validator.pubkey).toString(16).padStart(64, '0'));
                        const verifyKey = crypto.createPublicKey({
                            format: 'der',
                            type: 'spki',
                            key,
                        });
                        const result = crypto.verify(null, message, verifyKey, Buffer.from(item.signature, 'base64'));
                        assert(result === true);
                        totalWeight += Number(validator.weight);
                    }
                }
            }
            assert(totalWeight > 0);
            assert(totalWeight * 3 > sumLargestTotalWeights * 2);
            console.log('Masterchain block is verified successfully!');
        }
    }

    async sendNewKeyBlock(
        provider: ContractProvider,
        via: Sender,
        blockHeader: liteServer_blockHeader,
        block: liteServer_BlockData,
        signatures: ValidatorSignature[],
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

        const message = Buffer.concat([
            // magic prefix of message signing
            Buffer.from([0x70, 0x6e, 0x0b, 0xc5]),
            Cell.fromBoc(Buffer.from(blockHeader.headerProof))[0].refs[0].hash(0),
            Buffer.from(blockHeader.id.fileHash),
        ]);
        LiteClient.testBlockData(blockDataCell, signatures, message); // console.log('works for 27533522');

        const blockCell = beginCell().storeRef(blockHeaderCell).storeRef(blockDataCell).endCell();
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

        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Op.new_key_block, 32)
                .storeUint(0, 64)
                .storeRef(blockCell)
                .storeDict(signaturesCell)
                .endCell(),
            value: toNano('0.05'),
        });
    }
}
