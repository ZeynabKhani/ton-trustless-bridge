import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LiteClient } from '../wrappers/LiteClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as fs from 'fs';
import { liteServer_BlockData } from 'ton-lite-client/dist/schema';
import { liteServer_blockHeader } from 'ton-lite-client/dist/schema';
import TonRocks, { ValidatorSignature } from '@oraichain/tonbridge-utils';
import { TransactionChecker } from '../wrappers/TransactionChecker';
import { Cell as TonRocksCell } from '@oraichain/tonbridge-utils/build/types/Cell';

describe.only('TransactionChecker', () => {
    let code: Cell;
    let txData: any;
    let txWithProof: any;
    let blockData: any;
    let blockHeader: liteServer_blockHeader;
    let block: liteServer_BlockData;
    let signatures: ValidatorSignature[];

    beforeAll(async () => {
        code = await compile('TransactionChecker');
        // Load the test data
        const txDataRaw = fs.readFileSync(require.resolve('./txData.json'), 'utf8');
        txData = JSON.parse(txDataRaw);
        txWithProof = {
            kind: txData.kind,
            id: txData.id,
            proof: txData.proof,
            transaction: txData.transaction,
        };

        const blockDataRaw = fs.readFileSync(require.resolve('./blockForTx.json'), 'utf8');
        blockData = JSON.parse(blockDataRaw);

        blockHeader = {
            kind: blockData.header.kind,
            id: blockData.header.id,
            mode: blockData.header.mode,
            headerProof: blockData.header.headerProof,
        };
        block = {
            kind: blockData.block.kind,
            id: blockData.block.id,
            data: blockData.block.data,
        };
        signatures = blockData.signatures;
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let transactionChecker: SandboxContract<TransactionChecker>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        transactionChecker = blockchain.openContract(TransactionChecker.createFromConfig({ workchain: 0 }, code, 0));
        
        deployer = await blockchain.treasury('deployer');

        const deployResult = await transactionChecker.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: transactionChecker.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // console.log(Buffer.from(txWithProof.id.rootHash).toString('hex'))

        const txProof = await TonRocks.types.Cell.fromBoc(Buffer.from(txWithProof.proof));
        const txProofFirstRef: TonRocksCell = txProof[0].refs[0];
        
        // Prove that the transaction proof is related to our verified block
        const txProofHash = txProofFirstRef.hashes[0];
        // console.log("1:", Buffer.from(blockHeader.id.rootHash).toString('hex'))
        // console.log("2:", Buffer.from(txProofHash).toString('hex'))
        //44477283723053006053453491358860383818778593468817379682038688175347672068976
        await transactionChecker.sendCheckTransaction(deployer.getSender(), txWithProof, blockHeader, block, signatures);
    });
});
