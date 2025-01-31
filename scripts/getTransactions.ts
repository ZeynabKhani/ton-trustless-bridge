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
import { compile, NetworkProvider } from '@ton/blueprint';

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

export async function run(provider: NetworkProvider) {
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

    let friendlyValidators: UserFriendlyValidator[] = [];

    let existingData = {};

    // await verifyMasterchainBlock(client, blockInfo, friendlyValidators);

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
                // This is like Additional check for rootHash in parseBlock
                const blockHeader = await client.getBlockHeader(tx.blockId);
                const headerData = {
                    header: {
                        id: blockHeader.id,
                        headerProof: blockHeader.headerProof,
                        mode: blockHeader.mode,
                    },
                    roothash: blockHeader.id.rootHash.toString('hex'),
                };
                let existingData = {};
                if (fs.existsSync('tests/blockForTx.json')) {
                    existingData = JSON.parse(fs.readFileSync('tests/blockForTx.json', 'utf8'));
                }
                const mergedData = { ...existingData, ...headerData };
                fs.writeFileSync('tests/blockForTx.json', JSON.stringify(mergedData, null, 2));
                console.log('Block header written to tests/blockForTx.json');
                
                const blockHash = Cell.fromBoc(blockHeader.headerProof)[0].refs[0].hash(0);
                assert(blockHash.toString('hex') === blockHeader.id.rootHash.toString('hex'));
                // console.log(blockHash.toString('hex'))
                console.log('masterchain block:', tx.blockId.seqno);

                const tonweb = new TonWeb(
                    new TonWeb.HttpProvider('https://testnet.toncenter.com/api/v2/jsonRPC', {
                        apiKey: process.env.apiKey,
                    }),
                );
                try {
                    const valSignatures = (await tonweb.provider.send('getMasterchainBlockSignatures', {
                        seqno: tx.blockId.seqno,
                    })) as any;
                    const signatures = valSignatures.signatures as ValidatorSignature[];

                    const signaturesData = {
                        signatures: signatures,
                    };
                    if (fs.existsSync('tests/blockForTx.json')) {
                        existingData = JSON.parse(fs.readFileSync('tests/blockForTx.json', 'utf8'));
                    }
                    const mergedData = { ...existingData, ...signaturesData };
                    fs.writeFileSync('tests/blockForTx.json', JSON.stringify(mergedData, null, 2));
                    console.log('Signatures written to tests/blockForTx.json');
                } catch (error) {
                    console.error('Error fetching block signatures:', error);
                    throw error;
                }

                let blockInfo = master.last;
                let parsedBlock: ParsedBlock;

                const block = await engine.query(Functions.liteServer_getBlock, {
                    kind: 'liteServer.getBlock',
                    id: blockInfo,
                });
                parsedBlock = await parseBlock(block);
                try {
                    console.log('parsed key block seqno:', parsedBlock.info.seq_no);
                    // console.log('parsed block validator set:', validatorSet);
                    const blockData = {
                        block: {
                            kind: block.kind,
                            id: block.id,
                            data: block.data,
                        },
                    };
                    if (fs.existsSync('tests/blockForTx.json')) {
                        existingData = JSON.parse(fs.readFileSync('tests/blockForTx.json', 'utf8'));
                    }
                    const mergedData = { ...existingData, ...blockData };
                    fs.writeFileSync('tests/blockForTx.json', JSON.stringify(mergedData, null, 2));
                    console.log('Block data written to tests/blockForTx.json');
                } catch (error) {
                    console.error('Error accessing block config:', error);
                }
            }
        } catch (error) {
            console.error('Error verifying masterchain block:', error);
        }

        // Query the transaction proof
        const txWithProof = await client.getAccountTransaction(addr, tx.tx.lt.toString(10), tx.blockId);
        existingData = {};
        if (fs.existsSync('tests/txData.json')) {
            existingData = JSON.parse(fs.readFileSync('tests/txData.json', 'utf8'));
        }


        const txProof = await TonRocks.types.Cell.fromBoc(txWithProof.proof);
        const txProofFirstRef: TonRocksCell = txProof[0].refs[0];

        // Prove that the transaction proof is related to our verified block
        const txProofHash = txProofFirstRef.hashes[0];
        assert(Buffer.from(txProofHash).toString('hex') === tx.blockId.rootHash.toString('hex'));

        const txData = {
            id: txWithProof.id,
            proof: txWithProof.proof,
            transaction: txWithProof.transaction,
            rootHash: Buffer.from(txProofHash).toString('hex')
        };

        const mergedData = { ...existingData, ...txData };
        fs.writeFileSync('tests/txData.json', JSON.stringify(mergedData, null, 2));
        console.log('tx with proof written to tests/txData.json');


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
                    if (txHash === wantedTxHash) {
                        foundWantedTxHash = true;
                    }
                }
            }
        }
        assert(foundWantedTxHash);
        console.log('Transaction is verified successfully!');
    }
    engine.close();

}
