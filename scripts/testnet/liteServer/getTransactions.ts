import TonRocks, { ParsedBlock } from '@oraichain/tonbridge-utils';
import { Cell as TonRocksCell } from '@oraichain/tonbridge-utils/build/types/Cell';
import { Cell, Address, loadTransaction } from '@ton/core';
import assert from 'assert';
import 'dotenv/config';
import { LiteClient, LiteEngine, LiteRoundRobinEngine, LiteSingleEngine } from 'ton-lite-client';
import { liteServer_BlockData } from 'ton-lite-client/dist/schema';
import { BlockID } from 'ton-lite-client/dist';
import * as fs from 'fs';
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

(async () => {
    const jsonData = fs.readFileSync('scripts/testnet/liteServer/testnet-global-config.json', 'utf8');
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

    // Find an account transaction in a key block
    const initialDataRaw = fs.readFileSync('tests/testnet/keyblock2.json', 'utf8');
    let initialData = JSON.parse(initialDataRaw);
    let blockInfo: BlockID = initialData.header.id;
    blockInfo.rootHash = Buffer.from(blockInfo.rootHash);
    blockInfo.fileHash = Buffer.from(blockInfo.fileHash);

    const txCount = 1;
    const addr = Address.parse('Ef8zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM0vF');
    const accState = await client.getAccountState(addr, blockInfo);
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
        const hashFromData = tx.tx.raw.hash().toString('hex');
        const wantedTxHash = tx.tx.hash().toString('hex');
        assert(hashFromData === wantedTxHash);
        // Query the transaction proof
        const txWithProof = await client.getAccountTransaction(addr, tx.tx.lt.toString(10), tx.blockId);
        if (txWithProof.id.seqno == initialData.header.id.seqno) {
            const txProof = await TonRocks.types.Cell.fromBoc(txWithProof.proof);

            const txProofFirstRef: TonRocksCell = txProof[0].refs[0];

            // Prove that the transaction proof is related to our verified block
            const txProofHash = txProofFirstRef.hashes[0];
            assert(Buffer.from(txProofHash).toString('hex') === tx.blockId.rootHash.toString('hex'));

            // parse block to get block transactions
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

            const txData = {
                transaction: tx.tx.raw.toBoc(),
                proof: txWithProof.proof,
                blockId: txWithProof.id,
            };

            fs.writeFileSync('tests/testnet/txDataFromKeyBlock2.json', JSON.stringify(txData, null, 2));
            console.log('tx with proof written to tests/testnet/txDataFromKeyBlock2.json');
        }
    }
    engine.close();
})();
