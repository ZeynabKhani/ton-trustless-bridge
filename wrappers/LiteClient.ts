import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    DictionaryValue,
    Sender,
    SendMode,
    Slice,
    toNano,
    Builder,
} from '@ton/core';
import crypto from 'crypto';
import { Op } from './Constants';
import { liteServer_BlockData } from 'ton-lite-client/dist/schema';
import { liteServer_blockHeader } from 'ton-lite-client/dist/schema';
import TonRocks, { pubkeyHexToEd25519DER } from '@oraichain/tonbridge-utils';
import { assert } from 'node:console';
import { sha256 } from '@ton/crypto';
import { BitString, ValidatorSignature } from '@oraichain/tonbridge-utils/build/types';

export type LiteClientConfig = {
    prev_validator_set: Dictionary<number, ValidatorDescr>;
    cur_validator_set: Dictionary<number, ValidatorDescr>;
    next_validator_set: Dictionary<number, ValidatorDescr>;
    utime_since: number;
    utime_until: number;
};

export function liteClientConfigToCell(config: LiteClientConfig): Cell {
    return beginCell()
        .storeDict(config.prev_validator_set)
        .storeDict(config.cur_validator_set)
        .storeDict(config.next_validator_set)
        .storeUint(config.utime_since, 32)
        .storeUint(config.utime_until, 32)
        .endCell();
}

interface SigPubKey {
    _: 'SigPubKey';
    pubkey: any;
}

interface ValidatorDescr {
    _: 'ValidatorDescr';
    type: 'sig_pubkey' | 'addr';
    public_key: SigPubKey;
    weight: bigint;
    adnl_addr?: bigint;
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
        type: 'sig_pubkey',
        public_key: { _: 'SigPubKey', pubkey: BigInt(0) },
        weight: BigInt(0),
    };

    let type = s.loadUint(8);
    if (type === 0x53) {
        data.type = 'sig_pubkey';
        data.public_key = loadSigPubKey(s);
        data.weight = s.loadUintBig(64);
        return data;
    } else if (type === 0x73) {
        data.type = 'addr';
        data.public_key = loadSigPubKey(s);
        data.weight = s.loadUintBig(64);
        data.adnl_addr = s.loadUintBig(256);
        return data;
    }
    throw Error('not a ValidatorDescr');
}

function ValidatorDescrValue(): DictionaryValue<ValidatorDescr> {
    return {
        serialize: (src: ValidatorDescr, builder: Builder) => {
            if (src.type === 'sig_pubkey') {
                builder
                    .storeUint(0x53, 8) // type byte for pubkey only
                    .storeUint(0x8e81278a, 32) // SigPubKey magic
                    .storeUint(src.public_key.pubkey, 256)
                    .storeUint(BigInt(src.weight), 64); // Convert weight to BigInt
            } else if (src.type === 'addr') {
                builder
                    .storeUint(0x73, 8) // type byte for with ADNL address
                    .storeUint(0x8e81278a, 32) // SigPubKey magic
                    .storeUint(src.public_key.pubkey, 256)
                    .storeUint(BigInt(src.weight), 64) // Convert weight to BigInt
                    .storeUint(src.adnl_addr || 0, 256);
            }
        },
        parse: (src: Slice): ValidatorDescr => {
            const type = src.loadUint(8);
            const result: ValidatorDescr = {
                _: 'ValidatorDescr',
                type: type === 0x53 ? 'sig_pubkey' : 'addr',
                public_key: loadSigPubKey(src),
                weight: src.loadUintBig(64), // Load as BigInt
                adnl_addr: type === 0x73 ? src.loadUintBig(256) : undefined,
            };
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

    static getTestnetValidatorSet(McBlockExtra: Slice) {
        McBlockExtra.loadRef(); // shard_hashes
        McBlockExtra.loadRef(); // shard_fees
        McBlockExtra.loadRef(); // additional_info

        let curValidatorSet: Dictionary<number, ValidatorDescr> = Dictionary.empty(
            Dictionary.Keys.Uint(16),
            ValidatorDescrValue(),
        );
        let prevValidatorSet: Dictionary<number, ValidatorDescr> = Dictionary.empty(
            Dictionary.Keys.Uint(16),
            ValidatorDescrValue(),
        );
        let nextValidatorSet: Dictionary<number, ValidatorDescr> = Dictionary.empty(
            Dictionary.Keys.Uint(16),
            ValidatorDescrValue(),
        );
        let utime_since: number = 0;
        let utime_until: number = 0;
        let configParamsCell = McBlockExtra.loadDict(Dictionary.Keys.Uint(32), Dictionary.Values.Cell());
        // McBlockExtra.loadBits(75); // not sure what this is
        // McBlockExtra.loadBits(256); // config_address

        // loading current validator set
        let configParam34 = configParamsCell.get(34)!.beginParse();
        const type = configParam34.loadUint(8);
        utime_since = configParam34.loadUint(32);
        utime_until = configParam34.loadUint(32);
        const total = configParam34.loadUint(16);
        const main = configParam34.loadUint(16);
        if (total! < main!) throw Error('data.total < data.main');
        if (main! < 1) throw Error('data.main < 1');
        if (type === 0x11) {
            curValidatorSet = configParam34.loadDict(Dictionary.Keys.Uint(16), ValidatorDescrValue());
            // console.log(type, utime_since, utime_until, total, main, list);
        } else if (type === 0x12) {
            // type = 'ext';
            const total_weight = configParam34.loadUintBig(64);
            curValidatorSet = configParam34.loadDict(Dictionary.Keys.Uint(16), ValidatorDescrValue());
            // console.log(type, utime_since, utime_until, total, main, total_weight, list);
        }

        // loading previous validator set
        let configParam32 = configParamsCell.get(32)!.beginParse();
        configParam32.loadUintBig(8 + 32 + 32 + 16 + 16);
        if (type === 0x11) {
            prevValidatorSet = configParam32.loadDict(Dictionary.Keys.Uint(16), ValidatorDescrValue());
        } else if (type === 0x12) {
            configParam32.loadUintBig(64);
            prevValidatorSet = configParam32.loadDict(Dictionary.Keys.Uint(16), ValidatorDescrValue());
        }

        // loading next validator set
        let configParam36 = configParamsCell.get(36)?.beginParse();
        if (configParam36) {
            configParam36.loadUintBig(8 + 32 + 32 + 16 + 16);
            if (type === 0x11) {
                nextValidatorSet = configParam36.loadDict(Dictionary.Keys.Uint(16), ValidatorDescrValue());
            } else if (type === 0x12) {
                configParam36.loadUintBig(64);
                nextValidatorSet = configParam36.loadDict(Dictionary.Keys.Uint(16), ValidatorDescrValue());
            }
        }

        return {
            curValidatorSet,
            prevValidatorSet,
            nextValidatorSet,
            utime_since,
            utime_until,
        };
    }

    static getFastnetValidatorSet(McBlockExtra: Slice) {
        McBlockExtra.loadRef(); // additional_info
        McBlockExtra.loadUintBig(267); // config_address

        let configParamsCell = McBlockExtra.loadDict(Dictionary.Keys.Uint(32), Dictionary.Values.Cell());
        let utime_since: number = 0;
        let utime_until: number = 0;
        let total: number = 0;
        let main: number = 0;

        let curValidatorSet: Dictionary<number, ValidatorDescr> = Dictionary.empty(
            Dictionary.Keys.Uint(16),
            ValidatorDescrValue(),
        );
        let prevValidatorSet: Dictionary<number, ValidatorDescr> = Dictionary.empty(
            Dictionary.Keys.Uint(16),
            ValidatorDescrValue(),
        );
        let nextValidatorSet: Dictionary<number, ValidatorDescr> = Dictionary.empty(
            Dictionary.Keys.Uint(16),
            ValidatorDescrValue(),
        );

        // Check if param 34 exists
        const param34 = configParamsCell.get(34);
        if (!param34) {
            console.log('Config param 34 not found in fastnet');
            return {
                utime_since,
                utime_until,
                curValidatorSet,
                prevValidatorSet,
                nextValidatorSet,
            };
        }

        let configParam34 = param34.beginParse();

        const type = configParam34.loadUint(8);
        utime_since = configParam34.loadUint(32);
        utime_until = configParam34.loadUint(32);
        total = configParam34.loadUint(16);
        main = configParam34.loadUint(16);

        if (type === 0x11) {
            curValidatorSet = configParam34.loadDict(Dictionary.Keys.Uint(16), ValidatorDescrValue());
            // console.log(type, utime_since, utime_until, total, main, list);
        } else if (type === 0x12) {
            // type = 'ext';
            const total_weight = configParam34.loadUintBig(64);
            curValidatorSet = configParam34.loadDict(Dictionary.Keys.Uint(16), ValidatorDescrValue());
            // console.log(type, utime_since, utime_until, total, main, total_weight, list);
        }

        // loading previous validator set
        let configParam32 = configParamsCell.get(32)!.beginParse();
        configParam32.loadUintBig(8 + 32 + 32 + 16 + 16);
        if (type === 0x11) {
            prevValidatorSet = configParam32.loadDict(Dictionary.Keys.Uint(16), ValidatorDescrValue());
        } else if (type === 0x12) {
            configParam32.loadUintBig(64);
            prevValidatorSet = configParam32.loadDict(Dictionary.Keys.Uint(16), ValidatorDescrValue());
        }

        // loading next validator set
        let configParam36 = configParamsCell.get(36)?.beginParse();
        if (configParam36) {
            configParam36.loadUintBig(8 + 32 + 32 + 16 + 16);
            if (type === 0x11) {
                nextValidatorSet = configParam36.loadDict(Dictionary.Keys.Uint(16), ValidatorDescrValue());
            } else if (type === 0x12) {
                configParam36.loadUintBig(64);
                nextValidatorSet = configParam36.loadDict(Dictionary.Keys.Uint(16), ValidatorDescrValue());
            }
        }

        // console.log('utime_since', utime_since);
        // console.log('utime_until', utime_until);
        // console.log('prevValidatorSet', prevValidatorSet);
        // console.log('curValidatorSet', curValidatorSet);
        // console.log('nextValidatorSet', nextValidatorSet);

        return {
            curValidatorSet,
            prevValidatorSet,
            nextValidatorSet,
            utime_since,
            utime_until,
        };
    }

    static getInitialDataConfig(block: liteServer_BlockData, workchain: number) {
        const data = Cell.fromBoc(Buffer.from(block.data))[0].beginParse();
        data.loadUint(32);
        data.loadInt(32); // global_id
        const info = data.loadRef().beginParse();
        info.loadUint(32);
        info.loadUintBig(32 + 8 + 8 + 32 + 32);
        info.loadUintBig(2 + 6 + 32 + 64);
        const gen_utime = info.loadUint(32);
        // console.log('gen_utime', gen_utime);
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

        let curValidatorSet: Dictionary<number, ValidatorDescr> = Dictionary.empty(
            Dictionary.Keys.Uint(16),
            ValidatorDescrValue(),
        );
        let prevValidatorSet: Dictionary<number, ValidatorDescr> = Dictionary.empty(
            Dictionary.Keys.Uint(16),
            ValidatorDescrValue(),
        );
        let nextValidatorSet: Dictionary<number, ValidatorDescr> = Dictionary.empty(
            Dictionary.Keys.Uint(16),
            ValidatorDescrValue(),
        );
        let utime_since: number = 0;
        let utime_until: number = 0;
        if (key_block) {
            if (workchain == -1) {
                const testnetValidatorSet = LiteClient.getTestnetValidatorSet(McBlockExtra);
                curValidatorSet = testnetValidatorSet.curValidatorSet;
                prevValidatorSet = testnetValidatorSet.prevValidatorSet;
                nextValidatorSet = testnetValidatorSet.nextValidatorSet;
                utime_since = testnetValidatorSet.utime_since;
                utime_until = testnetValidatorSet.utime_until;
            } else if (workchain == 0) {
                const fastnetValidatorSet = LiteClient.getFastnetValidatorSet(McBlockExtra);
                curValidatorSet = fastnetValidatorSet.curValidatorSet;
                prevValidatorSet = fastnetValidatorSet.prevValidatorSet;
                nextValidatorSet = fastnetValidatorSet.nextValidatorSet;
                utime_since = fastnetValidatorSet.utime_since;
                utime_until = fastnetValidatorSet.utime_until;
            }
        }

        return {
            curValidatorSet,
            prevValidatorSet,
            nextValidatorSet,
            utime_since,
            utime_until,
        };
    }

    static async testBlockData(
        blockDataCell: Cell,
        signatures: ValidatorSignature[],
        message: Buffer,
        workchain: number,
    ) {
        const testBlockDataCell = blockDataCell.beginParse();
        testBlockDataCell.loadInt(32);
        testBlockDataCell.loadRef();
        const data = testBlockDataCell.loadRef().beginParse();
        data.loadUint(32);
        data.loadInt(32); // global_id
        const info = data.loadRef().beginParse();
        info.loadUint(32);
        info.loadUintBig(32 + 8 + 8 + 32 + 32);
        info.loadUintBig(2 + 6 + 32 + 64);
        const gen_utime = info.loadUint(32);
        // console.log('gen_utime', gen_utime);
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

        let curValidatorSet: Dictionary<number, ValidatorDescr> = Dictionary.empty(
            Dictionary.Keys.Uint(16),
            ValidatorDescrValue(),
        );
        let prevValidatorSet: Dictionary<number, ValidatorDescr> = Dictionary.empty(
            Dictionary.Keys.Uint(16),
            ValidatorDescrValue(),
        );
        let nextValidatorSet: Dictionary<number, ValidatorDescr> = Dictionary.empty(
            Dictionary.Keys.Uint(16),
            ValidatorDescrValue(),
        );
        let utime_since: number = 0;
        let utime_until: number = 0;
        if (key_block) {
            if (workchain == -1) {
                const testnetValidatorSet = LiteClient.getTestnetValidatorSet(McBlockExtra);
                curValidatorSet = testnetValidatorSet.curValidatorSet;
                prevValidatorSet = testnetValidatorSet.prevValidatorSet;
                nextValidatorSet = testnetValidatorSet.nextValidatorSet;
                utime_since = testnetValidatorSet.utime_since;
                utime_until = testnetValidatorSet.utime_until;
            } else if (workchain == 0) {
                const fastnetValidatorSet = LiteClient.getFastnetValidatorSet(McBlockExtra);
                curValidatorSet = fastnetValidatorSet.curValidatorSet;
                prevValidatorSet = fastnetValidatorSet.prevValidatorSet;
                nextValidatorSet = fastnetValidatorSet.nextValidatorSet;
                utime_since = fastnetValidatorSet.utime_since;
                utime_until = fastnetValidatorSet.utime_until;
            }
        }

        // let validatorSet: Dictionary<number, ValidatorDescr> | null = null;
        // if (key_block) {

        //     let sumLargestTotalWeights = 0;
        //     for (const [_, validator] of validatorSet!) {
        //         sumLargestTotalWeights += Number(validator.weight);
        //     }

        //     let friendlyValidators: UserFriendlyValidator[] = [];
        //     for (const entry of validatorSet!) {
        //         // magic number prefix for a node id of a validator
        //         const nodeIdPrefix = Buffer.from([0xc6, 0xb4, 0x13, 0x48]);
        //         const pubkey = entry[1].public_key.pubkey;
        //         // Convert BigInt pubkey to hex string, pad to 64 chars, then convert to Buffer
        //         const pubkeyBuffer = Buffer.from(pubkey.toString(16).padStart(64, '0'), 'hex');
        //         // Now concatenate the buffers
        //         const nodeId = await sha256(Buffer.concat([nodeIdPrefix, pubkeyBuffer]));
        //         friendlyValidators.push({
        //             ...entry[1],
        //             node_id: nodeId.toString('base64'),
        //             weight: entry[1].weight,
        //             pubkey,
        //         });
        //     }

        //     let totalWeight = 0;
        //     for (const item of signatures) {
        //         for (const validator of friendlyValidators) {
        //             if (validator.node_id === item.node_id_short) {
        //                 const key = pubkeyHexToEd25519DER(BigInt(validator.pubkey).toString(16).padStart(64, '0'));
        //                 const verifyKey = crypto.createPublicKey({
        //                     format: 'der',
        //                     type: 'spki',
        //                     key,
        //                 });
        //                 const result = crypto.verify(null, message, verifyKey, Buffer.from(item.signature, 'base64'));
        //                 assert(result === true);
        //                 totalWeight += Number(validator.weight);
        //             }
        //         }
        //     }
        //     assert(totalWeight > 0);
        //     assert(totalWeight * 3 > sumLargestTotalWeights * 2);
        //     console.log('Masterchain block is verified successfully!');
        // }
    }

    static newKeyBlockMessage(
        blockHeader: liteServer_blockHeader,
        block: liteServer_BlockData,
        signatures: ValidatorSignature[],
        workchain: number,
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
        LiteClient.testBlockData(blockDataCell, signatures, message, workchain);

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

        const messageBody = beginCell()
            .storeUint(Op.new_key_block, 32)
            .storeUint(0, 64)
            .storeRef(blockCell)
            .storeDict(signaturesCell)
            .endCell();

        return messageBody;
    }

    async sendNewKeyBlock(
        provider: ContractProvider,
        via: Sender,
        blockHeader: liteServer_blockHeader,
        block: liteServer_BlockData,
        signatures: ValidatorSignature[],
        workchain: number,
        value: bigint,
    ) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: LiteClient.newKeyBlockMessage(blockHeader, block, signatures, workchain),
            value: value,
        });
    }

    static checkBlockMessage(
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

        // const message = Buffer.concat([
        //     // magic prefix of message signing
        //     Buffer.from([0x70, 0x6e, 0x0b, 0xc5]),
        //     Cell.fromBoc(Buffer.from(blockHeader.headerProof))[0].refs[0].hash(0),
        //     Buffer.from(blockHeader.id.fileHash),
        // ]);
        // LiteClient.testBlockData(blockDataCell, signatures, message);

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

        const messageBody = beginCell()
            .storeUint(Op.check_block, 32)
            .storeUint(0, 64)
            .storeRef(blockCell)
            .storeDict(signaturesCell)
            .endCell();
        return messageBody;
    }

    async sendCheckBlock(
        provider: ContractProvider,
        via: Sender,
        blockHeader: liteServer_blockHeader,
        block: liteServer_BlockData,
        signatures: ValidatorSignature[],
        value: bigint,
    ) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: LiteClient.checkBlockMessage(blockHeader, block, signatures),
            value: value,
        });
    }

    async getUtimeSince(provider: ContractProvider) {
        const res = await provider.get('get_utime_since', []);
        return res.stack.readNumber();
    }

    async getUtimeUntil(provider: ContractProvider) {
        const res = await provider.get('get_utime_until', []);
        return res.stack.readNumber();
    }
}
