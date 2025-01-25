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
    // Additional check for rootHash
    const rootHash = Buffer.from(rootCell.hashes[0]).toString('hex');
    if (rootHash !== block.id.rootHash.toString('hex')) {
        throw Error('got wrong block or here was a wrong root_hash format');
    }
    const parsedBlock = TonRocks.bc.BlockParser.parseBlock(rootCell);
    return parsedBlock;
}

async function verifyMasterchainBlock(
    liteClient: LiteClient,
    blockId: tonNode_blockIdExt,
    validators: UserFriendlyValidator[],
) {
    // This is like Additional check for rootHash in parseBlock
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
        // sort and get the largest top 100 validator weights
        // this is because in TON, when validating a block, only at most 100 validators participated in a pool of 300+ validators
        const sumLargestTotalWeights = validators
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 100)
            .map((val) => val.weight)
            .reduce((prev, cur) => prev + cur);
        const message = Buffer.concat([
            // magic prefix of message signing
            Buffer.from([0x70, 0x6e, 0x0b, 0xc5]),
            blockHash,
            blockHeader.id.fileHash,
        ]);
        let totalWeight = 0;
        for (const item of signatures) {
            const validator = validators.find((val) => val.node_id === item.node_id_short);
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
        try {
            nextValidatorSet = parsedBlock.extra?.custom?.config?.config?.map?.get('24');
            if (nextValidatorSet === undefined) {
                console.log('No next validator set found in config (key 24)');
            } else {
                console.log('parsed key block seqno:', parsedBlock.info.seq_no);
                // console.log('parsed block validator set:', validatorSet);
            }
        } catch (error) {
            console.error('Error accessing block config:', error);
        }
        break;
    }

    let friendlyValidators: UserFriendlyValidator[] = [];
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

    // We find the transaction that we want to verify given an account, verify its block and then verify the tx
    await sleep(2000);
    const latestBlock2 = await client.getMasterchainInfo();
    const txCount = 1;
    const addr = Address.parse('Ef8zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM0vF');
    const accState = await client.getAccountState(addr, latestBlock2.last);
    if (!accState.lastTx) {
        throw new Error('No transactions found for account');
    }
    const offset = {
        hash: accState.lastTx.hash.toString(16),
        lt: accState.lastTx.lt.toString(10),
    };
    const rawTxs = await client.getAccountTransactions(addr, offset.lt, Buffer.from(offset.hash, 'hex'), txCount);
    assert(rawTxs.ids.length === txCount);
    const txs = Cell.fromBoc(rawTxs.transactions).map((cell, i) => ({
        tx: loadTransaction(cell.asSlice()),
        blockId: rawTxs.ids[i],
    }));

    for (let tx of txs) {
        const wantedTxHash = tx.tx.hash().toString('hex');
        console.log('wanted tx hash: ', wantedTxHash);
        try {
            // it means this tx is in a shard block -> we verify shard blocks along with materchain block
            if (tx.blockId.workchain !== -1) {
                throw new Error('Transaction is in a shard block');
            } else {
                await verifyMasterchainBlock(client, tx.blockId, friendlyValidators);
            }
        } catch (error) {
            console.error('Error verifying masterchain block:', error);
        }

        // Query the transaction proof
        const txWithProof = await client.getAccountTransaction(addr, tx.tx.lt.toString(10), tx.blockId);
        const txProof = await TonRocks.types.Cell.fromBoc(txWithProof.proof);
        const txProofFirstRef: TonRocksCell = txProof[0].refs[0];

        // Prove that the transaction proof is related to our verified block
        const txProofHash = txProofFirstRef.hashes[0];
        assert(Buffer.from(txProofHash).toString('hex') === tx.blockId.rootHash.toString('hex'));

        // parse block to get block transactions to prove that the wantedTxHash got fromtx.tx.hash().toString("hex") is in the transaction proof.
        const blockExtraCell: TonRocksCell = txProofFirstRef.refs[3];
        const parsedBlockFromTxProof = loadBlockExtra(blockExtraCell, {
            cs: 0,
            ref: 0,
        });
        const accountBlocks = parsedBlockFromTxProof.account_blocks.map;
        let foundWantedTxHash = false;
        for (const entry of accountBlocks.entries()) {
            const txs = entry[1].value.transactions.map;
            for (const [_key, tx] of txs.entries()) {
                const txCell: TonRocksCell = tx.value;
                if (tx.value) {
                    const txHash = Buffer.from(txCell.getHash(0)).toString('hex');
                    if (txHash === wantedTxHash) foundWantedTxHash = true;
                }
            }
        }
        assert(foundWantedTxHash);
        console.log('Transaction is verified successfully!');
    }
    engine.close();
})();
