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
    Builder,
} from '@ton/core';
import { Op } from './Constants';
import { liteServer_BlockData } from 'ton-lite-client/dist/schema';
import { liteServer_blockHeader } from 'ton-lite-client/dist/schema';
import { pubkeyHexToEd25519DER } from '@oraichain/tonbridge-utils';
import { assert } from 'node:console';
import { sha256 } from '@ton/crypto';
import { ValidatorSignature } from '@oraichain/tonbridge-utils/build/types';
import {
    createBlockHeaderCell,
    createSignatureCell,
    pruneExceptBlockInfo,
    pruneExceptBlockInfoAndMcBlockExtraConfigParams,
} from './Helpers';

export type LiteClientConfig = {
    prev_validator_set: Dictionary<number, ValidatorDescr>;
    cur_validator_set: Dictionary<number, ValidatorDescr>;
    next_validator_set: Dictionary<number, ValidatorDescr>;
    utime_since: number;
    utime_until: number;
    seqno: number;
    blocks_workchain: number;
};

export function liteClientConfigToCell(config: LiteClientConfig): Cell {
    return beginCell()
        .storeDict(config.prev_validator_set)
        .storeDict(config.cur_validator_set)
        .storeDict(config.next_validator_set)
        .storeUint(config.utime_since, 32)
        .storeUint(config.utime_until, 32)
        .storeInt(config.seqno, 32)
        .storeInt(BigInt(config.blocks_workchain), 1)
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

    static getValidatorSet(McBlockExtra: Slice, workchain: number) {
        if (workchain == -1) {
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
            } else if (type === 0x12) {
                // type = 'ext';
                const total_weight = configParam34.loadUintBig(64);
                curValidatorSet = configParam34.loadDict(Dictionary.Keys.Uint(16), ValidatorDescrValue());
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
        } else if (workchain == 0) {
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
            } else if (type === 0x12) {
                // type = 'ext';
                const total_weight = configParam34.loadUintBig(64);
                curValidatorSet = configParam34.loadDict(Dictionary.Keys.Uint(16), ValidatorDescrValue());
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
        return {
            curValidatorSet: Dictionary.empty(Dictionary.Keys.Uint(16), ValidatorDescrValue()),
            prevValidatorSet: Dictionary.empty(Dictionary.Keys.Uint(16), ValidatorDescrValue()),
            nextValidatorSet: Dictionary.empty(Dictionary.Keys.Uint(16), ValidatorDescrValue()),
            utime_since: 0,
            utime_until: 0,
        };
    }

    static getInitialDataConfig(block: liteServer_BlockData, workchain: number) {
        const data = Cell.fromBoc(Buffer.from(block.data))[0].beginParse();
        data.loadUint(32); // magic
        data.loadInt(32); // global_id
        const info = data.loadRef().beginParse();
        info.loadUint(32);
        info.loadUintBig(32 + 8 + 8 + 32 + 32);
        info.loadUintBig(2 + 6 + 32 + 64);
        const gen_utime = info.loadUint(32);
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
            const validatorSet = LiteClient.getValidatorSet(McBlockExtra, workchain);
            curValidatorSet = validatorSet.curValidatorSet;
            prevValidatorSet = validatorSet.prevValidatorSet;
            nextValidatorSet = validatorSet.nextValidatorSet;
            utime_since = validatorSet.utime_since;
            utime_until = validatorSet.utime_until;
        }

        return {
            curValidatorSet,
            prevValidatorSet,
            nextValidatorSet,
            utime_since,
            utime_until,
        };
    }

    static newKeyBlockMessage(
        blockHeader: liteServer_blockHeader,
        block: liteServer_BlockData,
        signatures: ValidatorSignature[],
        workchain: number,
    ) {
        const blockHeaderIdCell = beginCell()
            .storeInt(blockHeader.id.workchain, 32)
            .storeInt(blockHeader.id.seqno, 32)
            .storeUint(BigInt('0x' + Buffer.from(blockHeader.id.rootHash).toString('hex')), 256)
            .storeUint(BigInt('0x' + Buffer.from(blockHeader.id.fileHash).toString('hex')), 256)
            .endCell();
        const blockHeaderCell = beginCell()
            .storeRef(blockHeaderIdCell) // id
            .storeRef(Cell.fromBoc(Buffer.from(blockHeader.headerProof))[0]) // header_proof
            .endCell();

        const blockDataCell = beginCell()
            // .storeInt(0x6377cf0d, 32) // liteServer.getBlock
            // .storeRef(beginCell().endCell())
            .storeRef(
                pruneExceptBlockInfoAndMcBlockExtraConfigParams(Cell.fromBoc(Buffer.from(block.data))[0], workchain),
            )
            .endCell();

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

    static checkBlockMessage(
        blockHeader: liteServer_blockHeader,
        block: liteServer_BlockData,
        signatures: ValidatorSignature[],
    ) {
        const blockHeaderCell = createBlockHeaderCell(blockHeader);
        const blockDataCell = beginCell()
            .storeRef(pruneExceptBlockInfo(Cell.fromBoc(Buffer.from(block.data))[0]))
            .endCell();
        const blockCell = beginCell().storeRef(blockHeaderCell).storeRef(blockDataCell).endCell();

        const messageBody = beginCell()
            .storeUint(Op.check_block, 32)
            .storeUint(0, 64)
            .storeRef(blockCell)
            .storeDict(createSignatureCell(signatures))
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

    async getSeqno(provider: ContractProvider) {
        const res = await provider.get('get_seqno', []);
        return res.stack.readNumber();
    }

    async getBlocksWorkchain(provider: ContractProvider) {
        const res = await provider.get('get_blocks_workchain', []);
        return res.stack.readNumber();
    }

    async getPrevValidatorSet(provider: ContractProvider) {
        const res = await provider.get('get_prev_validator_set', []);
        return res.stack.readCell();
    }

    async getCurValidatorSet(provider: ContractProvider) {
        const res = await provider.get('get_cur_validator_set', []);
        return res.stack.readCell();
    }

    async getNextValidatorSet(provider: ContractProvider) {
        const res = await provider.get('get_next_validator_set', []);
        return res.stack.readCell();
    }

    async getAllData(provider: ContractProvider) {
        const res = await provider.get('get_all_data', []);
        return {
            prevValidatorSet: res.stack.readCell(),
            curValidatorSet: res.stack.readCell(),
            nextValidatorSet: res.stack.readCell(),
            utimeSince: res.stack.readNumber(),
            utimeUntil: res.stack.readNumber(),
            seqno: res.stack.readNumber(),
            blocksWorkchain: res.stack.readNumber(),
        };
    }
}
