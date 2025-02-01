import { UserFriendlyValidator } from '@oraichain/tonbridge-contracts-sdk/build/TonbridgeValidator.types';
import TonRocks, { ParsedBlock, pubkeyHexToEd25519DER, ValidatorSignature } from '@oraichain/tonbridge-utils';
import { Cell as TonRocksCell } from '@oraichain/tonbridge-utils/build/types/Cell';
import { Cell, Address, loadTransaction } from '@ton/core';
import { sha256 } from '@ton/crypto';
import assert from 'assert';
import crypto from 'crypto';
import 'dotenv/config';
import { LiteClient, LiteEngine, LiteRoundRobinEngine, LiteSingleEngine } from 'ton-lite-client';
import { Functions, liteServer_BlockData, tonNode_blockIdExt } from 'ton-lite-client/dist/schema';
import TonWeb from 'tonweb';
import * as fs from 'fs';
import { sleep } from '@ton/blueprint';
import { loadBlockExtra } from '@oraichain/tonbridge-utils/build/blockchain/BlockParser';

export function intToIP(int: number) {
    var part1 = int & 255;
    var part2 = (int >> 8) & 255;
    var part3 = (int >> 16) & 255;
    var part4 = (int >> 24) & 255;
    return part4 + '.' + part3 + '.' + part2 + '.' + part1;
}
export async function parseBlock(block: liteServer_BlockData): Promise<ParsedBlock> {
    const [rootCell] = await TonRocks.types.Cell.fromBoc(block.data);
    // Additional check for rootHash to validate the whole block and not just the block header
    const rootHash = Buffer.from(rootCell.hashes[0]).toString('hex');
    if (rootHash !== block.id.rootHash.toString('hex')) {
        throw Error('got wrong block or here was a wrong root_hash format');
    }
    const parsedBlock = TonRocks.bc.BlockParser.parseBlock(rootCell);
    return parsedBlock;
}

async function verifyMasterchainBlock(liteClient: LiteClient, blockId: tonNode_blockIdExt, validatorSet: any) {
    const block = await liteClient.engine.query(Functions.liteServer_getBlock, {
        kind: 'liteServer.getBlock',
        id: blockId,
    });
    const parsedBlock = await parseBlock(block);

    // Verifying the block header which is an exotic merkle proof cell with pruned branches
    const blockHeader = await liteClient.getBlockHeader(blockId);
    const blockHash = Cell.fromBoc(blockHeader.headerProof)[0].refs[0].hash(0);
    assert(blockHash.toString('hex') === blockHeader.id.rootHash.toString('hex'));
    console.log('masterchain block:', blockId.seqno);

    const tonweb = new TonWeb(
        new TonWeb.HttpProvider('https://testnet.toncenter.com/api/v2/jsonRPC', {
            apiKey: process.env.apiKey,
        }),
    );
    try {
        const valSignatures = (await tonweb.provider.send('getMasterchainBlockSignatures', {
            seqno: blockId.seqno,
        })) as any;
        const signatures = valSignatures.signatures as ValidatorSignature[];
        // for (const signature of signatures) {
        //     console.log('signature:', signature.node_id_short);
        // }
        const signaturesData = {
            signatures: signatures,
        };
        let existingData = {};
        if (fs.existsSync('tests/fastnet/keyblock1.json')) {
            existingData = JSON.parse(fs.readFileSync('tests/fastnet/keyblock1.json', 'utf8'));
        }
        const mergedData = { ...existingData, ...signaturesData };
        fs.writeFileSync('tests/fastnet/keyblock1.json', JSON.stringify(mergedData, null, 2));
        console.log('Signatures written to tests/fastnet/keyblock1.json');

        let friendlyValidators: UserFriendlyValidator[] = [];
        if (parsedBlock.extra?.custom?.config?.config?.map?.get('24') === undefined) {
            const prevKeyBlock = await liteClient.getFullBlock(parsedBlock.info.prev_key_block_seqno);
            const matchingShard = prevKeyBlock.shards.find(
                (shard) => shard.seqno === parsedBlock.info.prev_key_block_seqno,
            );
            if (!matchingShard) {
                throw new Error(`No shard found with seqno ${parsedBlock.info.prev_key_block_seqno}`);
            }
            const prevBlock = await liteClient.engine.query(Functions.liteServer_getBlock, {
                kind: 'liteServer.getBlock',
                id: {
                    kind: 'tonNode.blockIdExt',
                    ...matchingShard,
                },
            });
            const prevParsedBlock = await parseBlock(prevBlock);

            // Get previous validator set from config
            const prevValidatorSet = prevParsedBlock.extra?.custom?.config?.config?.map?.get('22');
            if (!prevValidatorSet) {
                throw new Error('Could not find previous validator set for key block verification');
            }
            validatorSet = prevValidatorSet;
        }

        for (const entry of validatorSet.cur_validators.list.map.entries()) {
            // magic number prefix for a node id of a validator
            const nodeIdPrefix = Buffer.from([0xc6, 0xb4, 0x13, 0x48]);
            const pubkey = entry[1].public_key.pubkey;
            // we need nodeId because the validator signatures returned from Toncenter only have nodeIds
            const nodeId = await sha256(Buffer.concat([nodeIdPrefix, pubkey]));
            friendlyValidators.push({
                ...entry[1],
                node_id: nodeId.toString('base64'),
                weight: +entry[1].weight.toString(),
                pubkey,
            });
        }

        const sumLargestTotalWeights = friendlyValidators
            .sort((a: any, b: any) => b.weight - a.weight)
            .slice(0, 100)
            .map((val: any) => val.weight)
            .reduce((prev: any, cur: any) => prev + cur);
        const message = Buffer.concat([
            // magic prefix of message signing
            Buffer.from([0x70, 0x6e, 0x0b, 0xc5]),
            blockHash,
            blockHeader.id.fileHash,
        ]);
        let totalWeight = 0;
        for (const item of signatures) {
            const validator = friendlyValidators.find((val: any) => val.node_id === item.node_id_short);
            if (!validator) continue;
            const key = pubkeyHexToEd25519DER(validator.pubkey);
            const verifyKey = crypto.createPublicKey({
                format: 'der',
                type: 'spki',
                key,
            });
            const result = crypto.verify(null, message, verifyKey, Buffer.from(item.signature, 'base64'));
            assert(result === true);
            totalWeight += validator.weight;
        }
        assert(totalWeight > 0);
        assert(totalWeight * 3 > sumLargestTotalWeights * 2);
        console.log('Masterchain block is verified successfully!');
    } catch (error) {
        console.error('Error fetching block signatures:', error);
        throw error;
    }
}

(async () => {
    const jsonData = fs.readFileSync(require.resolve('./testnet-global-config.json'), 'utf8');
    const data = JSON.parse(jsonData);

    // const { liteservers } = await fetch('https://ton.org/global-config.json').then((data) => data.json());
    const { liteservers } = data;
    const engines: LiteEngine[] = [];
    engines.push(
        ...liteservers.map(
            (server: any) =>
                new LiteSingleEngine({
                    host: `tcp://${intToIP(server.ip)}:${server.port}`,
                    publicKey: Buffer.from(server.id.key, 'base64'),
                }),
        ),
    );
    const engine = new LiteRoundRobinEngine(engines);
    const client = new LiteClient({ engine });
    const master = await client.getMasterchainInfo();

    // key block. Got this by querying a block, then deserialize it, then find prev_key_block_seqno
    // it has to be a key block to include validator set & block extra to parse into the contract
    let blockInfo = master.last;
    let parsedBlock: ParsedBlock;
    let validatorSet;
    let nextValidatorSet;
    let prevValidatorSet;
    let numberOfKeyBlocks = 0;
    while (true) {
        // get block
        const block = await engine.query(Functions.liteServer_getBlock, {
            kind: 'liteServer.getBlock',
            id: blockInfo,
        });
        parsedBlock = await parseBlock(block);
        if (!parsedBlock.info.key_block) {
            const keyBlockInfo = await client.getFullBlock(parsedBlock.info.prev_key_block_seqno);
            const matchingShard = keyBlockInfo.shards.find(
                (shard) => shard.seqno === parsedBlock.info.prev_key_block_seqno,
            );
            if (!matchingShard) {
                throw new Error(`No shard found with seqno ${parsedBlock.info.prev_key_block_seqno}`);
            }
            blockInfo = {
                kind: 'tonNode.blockIdExt',
                ...matchingShard,
            };
            continue;
        }
        try {
            validatorSet = parsedBlock.extra?.custom?.config?.config?.map?.get('22');
            if (validatorSet === undefined) {
                console.log('No validator set found in config (key 22)');
            } else {
                console.log('parsed key block seqno:', parsedBlock.info.seq_no);
                // console.log('parsed block validator set:', validatorSet);
            }
        } catch (error) {
            console.error('Error accessing block config:', error);
        }

        numberOfKeyBlocks++;
        if (numberOfKeyBlocks > 0) {
            const testData = {
                block: {
                    kind: block.kind,
                    id: block.id,
                    data: block.data,
                },
            };
            fs.writeFileSync('tests/block0.json', JSON.stringify(testData, null, 2));
            console.log('Block data written to tests/block0.json');
            break;
        }
        const keyBlockInfo = await client.getFullBlock(parsedBlock.info.prev_key_block_seqno);
        const matchingShard = keyBlockInfo.shards.find(
            (shard) => shard.seqno === parsedBlock.info.prev_key_block_seqno,
        );
        if (!matchingShard) {
            throw new Error(`No shard found with seqno ${parsedBlock.info.prev_key_block_seqno}`);
        }
        blockInfo = {
            kind: 'tonNode.blockIdExt',
            ...matchingShard,
        };
    }

    const blockHeader = await client.getBlockHeader(blockInfo);
    const testData = {
        header: {
            id: blockHeader.id,
            headerProof: blockHeader.headerProof,
            mode: blockHeader.mode,
        },
    };
    let existingData = {};
    if (fs.existsSync('tests/block0.json')) {
        existingData = JSON.parse(fs.readFileSync('tests/block0.json', 'utf8'));
    }
    const mergedData = { ...existingData, ...testData };
    fs.writeFileSync('tests/block0.json', JSON.stringify(mergedData, null, 2));
    console.log('Block header written to tests/block0.json');

    await verifyMasterchainBlock(client, blockInfo, validatorSet);

    engine.close();
})();
