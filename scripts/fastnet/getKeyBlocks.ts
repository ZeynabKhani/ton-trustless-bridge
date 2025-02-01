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

    try {
        console.log('Fetching block signatures for seqno:', blockId.seqno);

        const nextValidatorSet = parsedBlock.extra?.custom?.config?.config?.map?.get('24');
        if (nextValidatorSet === undefined) {
            console.log('No next validator set found in config (key 24)');

            // Get the previous key block info
            const prevBlock = await liteClient.engine.query(Functions.liteServer_lookupBlock, {
                kind: 'liteServer.lookupBlock',
                mode: 1,
                id: {
                    kind: 'tonNode.blockId',
                    workchain: -1,
                    shard: '-9223372036854776000',
                    seqno: parsedBlock.info.prev_key_block_seqno,
                },
                lt: '0',
                utime: 0,
            });

            // // Ensure we're using a valid masterchain block ID
            // const block = await liteClient.engine.query(Functions.liteServer_getBlock, {
            //     kind: 'liteServer.getBlock',
            //     id: {
            //         kind: 'tonNode.blockIdExt',
            //         workchain: -1,
            //         shard: '-9223372036854776000',
            //         seqno: prevBlock.id.seqno,
            //         rootHash: prevBlock.id.rootHash,
            //         fileHash: prevBlock.id.fileHash,
            //     },
            // });
            // const parsedPrevBlock = await parseBlock(block);
            // blockId = {
            //     kind: 'tonNode.blockIdExt',
            //     workchain: -1,
            //     shard: '-9223372036854776000',
            //     seqno: prevBlock.id.seqno,
            //     rootHash: prevBlock.id.rootHash,
            //     fileHash: prevBlock.id.fileHash,
            // };
            blockId = prevBlock.id;
        }

        // Get block proof that includes validator signatures
        const proof = await liteClient.engine.query(Functions.liteServer_getBlockProof, {
            kind: 'liteServer.getBlockProof',
            knownBlock: blockId,
            targetBlock: blockId,
            mode: 0,
        });

        if (!(proof.steps[0] as any)?.signatures?.signatures) {
            throw new Error('No signatures found in block extra');
        }

        const signatures = JSON.parse(JSON.stringify(proof.steps[0]));

        const signatureArray = signatures?.signatures?.signatures || [];
        const formattedSignatures = signatureArray.map((sig: any) => ({
            '@type': 'blocks.signature',
            node_id_short: Buffer.from(sig.nodeIdShort.data).toString('base64'),
            signature: Buffer.from(sig.signature.data).toString('base64'),
        }));

        const signaturesData = {
            signatures: formattedSignatures,
        };

        let existingData = {};
        if (fs.existsSync('tests/fastnet/keyblock4.json')) {
            existingData = JSON.parse(fs.readFileSync('tests/fastnet/keyblock4.json', 'utf8'));
        }
        const mergedData = { ...existingData, ...signaturesData };
        fs.writeFileSync('tests/fastnet/keyblock4.json', JSON.stringify(mergedData, null, 2));
        console.log('Signatures written to tests/fastnet/keyblock4.json');

        // let friendlyValidators: UserFriendlyValidator[] = [];
        // if (parsedBlock.extra?.custom?.config?.config?.map?.get('24') === undefined) {
        //     const prevKeyBlock = await liteClient.getFullBlock(parsedBlock.info.prev_key_block_seqno);
        //     const matchingShard = prevKeyBlock.shards.find(
        //         (shard) => shard.seqno === parsedBlock.info.prev_key_block_seqno,
        //     );
        //     if (!matchingShard) {
        //         throw new Error(`No shard found with seqno ${parsedBlock.info.prev_key_block_seqno}`);
        //     }
        //     const prevBlock = await liteClient.engine.query(Functions.liteServer_getBlock, {
        //         kind: 'liteServer.getBlock',
        //         id: {
        //             kind: 'tonNode.blockId',
        //             workchain: -1,
        //             shard: '-9223372036854776000',
        //             seqno: parsedBlock.info.prev_key_block_seqno,
        //             rootHash: Buffer.alloc(32),
        //             fileHash: Buffer.alloc(32),
        //         },
        //     });
        //     const prevParsedBlock = await parseBlock(prevBlock);

        //     // Get previous validator set from config
        //     const prevValidatorSet = prevParsedBlock.extra?.custom?.config?.config?.map?.get('22');
        //     if (!prevValidatorSet) {
        //         throw new Error('Could not find previous validator set for key block verification');
        //     }
        //     validatorSet = prevValidatorSet;
        // }

        // for (const entry of validatorSet.cur_validators.list.map.entries()) {
        //     // magic number prefix for a node id of a validator
        //     const nodeIdPrefix = Buffer.from([0xc6, 0xb4, 0x13, 0x48]);
        //     const pubkey = entry[1].public_key.pubkey;
        //     // we need nodeId because the validator signatures returned from Toncenter only have nodeIds
        //     const nodeId = await sha256(Buffer.concat([nodeIdPrefix, pubkey]));
        //     friendlyValidators.push({
        //         ...entry[1],
        //         node_id: nodeId.toString('base64'),
        //         weight: +entry[1].weight.toString(),
        //         pubkey,
        //     });
        // }

        // const sumLargestTotalWeights = friendlyValidators
        //     .sort((a: any, b: any) => b.weight - a.weight)
        //     .slice(0, 100)
        //     .map((val: any) => val.weight)
        //     .reduce((prev: any, cur: any) => prev + cur);
        // const message = Buffer.concat([
        //     // magic prefix of message signing
        //     Buffer.from([0x70, 0x6e, 0x0b, 0xc5]),
        //     blockHash,
        //     blockHeader.id.fileHash,
        // ]);
        // let totalWeight = 0;
        // for (const item of signaturesData.signatures) {
        //     const validator = friendlyValidators.find((val: any) => val.node_id === item.node_id_short);
        //     if (!validator) continue;
        //     const key = pubkeyHexToEd25519DER(validator.pubkey);
        //     const verifyKey = crypto.createPublicKey({
        //         format: 'der',
        //         type: 'spki',
        //         key,
        //     });
        //     const result = crypto.verify(null, message, verifyKey, Buffer.from(item.signature, 'base64'));
        //     assert(result === true);
        //     totalWeight += validator.weight;
        // }
        // assert(totalWeight > 0);
        // assert(totalWeight * 3 > sumLargestTotalWeights * 2);
        // console.log('Masterchain block is verified successfully!');
    } catch (error) {
        console.error('Error fetching block signatures:', error);
        throw error;
    }
}

async function getMasterchainKeyBlock(client: LiteClient, blockInfo: tonNode_blockIdExt) {
    let currentBlockInfo = blockInfo;
    let numberOfKeyBlocks = 0;
    while (true) {
        const block = await client.engine.query(Functions.liteServer_getBlock, {
            kind: 'liteServer.getBlock',
            id: currentBlockInfo,
        });
        const parsedBlock = await parseBlock(block);

        if (parsedBlock.info.key_block) {
            numberOfKeyBlocks++;
            if (numberOfKeyBlocks > 0) {
                return { block, parsedBlock };
            }
        }

        console.log('Not a key block, getting previous key block...');
        console.log('Previous key block seqno:', parsedBlock.info.prev_key_block_seqno);

        // Get the previous key block info
        const prevBlock = await client.engine.query(Functions.liteServer_lookupBlock, {
            kind: 'liteServer.lookupBlock',
            mode: 1,
            id: {
                kind: 'tonNode.blockId',
                workchain: -1,
                shard: '-9223372036854776000',
                seqno: parsedBlock.info.prev_key_block_seqno,
            },
            lt: '0',
            utime: 0,
        });

        currentBlockInfo = prevBlock.id;
    }
}

(async () => {
    const jsonData = fs.readFileSync(require.resolve('./fastnet-global-config.json'), 'utf8');
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

    let blockInfo = master.last;

    try {
        const { block: keyBlock, parsedBlock } = await getMasterchainKeyBlock(client, blockInfo);
        console.log('Found key block at seqno:', parsedBlock.info.seq_no);

        const validatorSet = parsedBlock.extra?.custom?.config?.config?.map?.get('22');
        if (validatorSet === undefined) {
            console.log('No validator set found in config (key 22)');
        } else {
            console.log('Validator set found in key block');
            const testData = {
                block: {
                    kind: keyBlock.kind,
                    id: keyBlock.id,
                    data: keyBlock.data,
                },
            };
            fs.writeFileSync('tests/fastnet/keyblock4.json', JSON.stringify(testData, null, 2));
            console.log('Block data written to tests/fastnet/keyblock4.json');
        }

        // Move block header logic inside try-catch and use keyBlock instead of block
        const blockHeader = await client.getBlockHeader(keyBlock.id);
        const testData = {
            header: {
                id: blockHeader.id,
                headerProof: blockHeader.headerProof,
                mode: blockHeader.mode,
            },
        };
        let existingData = {};
        if (fs.existsSync('tests/fastnet/keyblock4.json')) {
            existingData = JSON.parse(fs.readFileSync('tests/fastnet/keyblock4.json', 'utf8'));
        }
        const mergedData = { ...existingData, ...testData };
        fs.writeFileSync('tests/fastnet/keyblock4.json', JSON.stringify(mergedData, null, 2));
        console.log('Block header written to tests/fastnet/keyblock4.json');

        await verifyMasterchainBlock(client, keyBlock.id, validatorSet);
    } catch (error) {
        console.error('Error:', error);
    }

    engine.close();
})();
