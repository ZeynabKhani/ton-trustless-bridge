import TonRocks, { ParsedBlock } from '@oraichain/tonbridge-utils';
import { Cell as TonRocksCell } from '@oraichain/tonbridge-utils/build/types/Cell';
import { Cell, Address, loadTransaction } from '@ton/core';
import assert from 'assert';
import 'dotenv/config';
import { LiteClient, LiteEngine, LiteRoundRobinEngine, LiteSingleEngine } from 'ton-lite-client';
import { liteServer_BlockData } from 'ton-lite-client/dist/schema';
import { BlockID } from 'ton-lite-client/dist';
import * as fs from 'fs';

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

    // Find an account transaction in a key block
    const initialDataRaw = fs.readFileSync(require.resolve('../../tests/fastnet/keyblock2.json'), 'utf8');
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

    let existingData = {};
    for (let tx of txs) {
        // Query the transaction proof
        const txWithProof = await client.getAccountTransaction(addr, tx.tx.lt.toString(10), tx.blockId);
        if (txWithProof.id.seqno == initialData.header.id.seqno) {
            existingData = {};
            if (fs.existsSync('tests/fastnet/txDataFromKeyBlock2.json')) {
                existingData = JSON.parse(fs.readFileSync('tests/fastnet/txDataFromKeyBlock2.json', 'utf8'));
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
                rootHash: Buffer.from(txProofHash).toString('hex'),
            };

            const mergedData = { ...existingData, ...txData };
            fs.writeFileSync('tests/fastnet/txDataFromKeyBlock2.json', JSON.stringify(mergedData, null, 2));
            console.log('tx with proof written to tests/fastnet/txDataFromKeyBlock2.json');
        }
    }
    engine.close();
})();
