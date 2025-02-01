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
import { loadBlockExtra } from '@oraichain/tonbridge-utils/build/blockchain/BlockParser';
import { Op } from '../wrappers/Constants';

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
    let lt: SandboxContract<TreasuryContract>;
    let transactionChecker: SandboxContract<TransactionChecker>;
    let initialBlock: liteServer_BlockData;
    let liteClient: SandboxContract<LiteClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        
        const initialDataRaw = fs.readFileSync(require.resolve('./blockNew.json'), 'utf8');
        let initialData = JSON.parse(initialDataRaw);

        initialBlock = {
            kind: initialData.block.kind,
            id: initialData.block.id,
            data: initialData.block.data,
        };

        const { curValidatorSet, prevValidatorSet, nextValidatorSet, utime_since, utime_until } =
            LiteClient.getInitialDataConfig(initialBlock);

        liteClient = blockchain.openContract(
            LiteClient.createFromConfig(
                {
                    prev_validator_set: prevValidatorSet,
                    cur_validator_set: curValidatorSet,
                    next_validator_set: nextValidatorSet,
                    utime_since,
                    utime_until,
                },
                code,
                0,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        let deployResult = await liteClient.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: liteClient.address,
            deploy: true,
            success: true,
        });
        
        
        transactionChecker = blockchain.openContract(TransactionChecker.createFromConfig({ 
            lite_client: liteClient.address,
        }, code, 0));
        
        deployer = await blockchain.treasury('deployer');

        deployResult = await transactionChecker.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: transactionChecker.address,
            deploy: true,
            success: true,
        });
    });

    it('should return correct', async () => {
        // console.log(Buffer.from(txWithProof.id.rootHash).toString('hex'))

        const txProof = await TonRocks.types.Cell.fromBoc(Buffer.from(txWithProof.proof));
        const txProofFirstRef: TonRocksCell = txProof[0].refs[0];
        const blockExtraCell: TonRocksCell = txProofFirstRef.refs[3];
        const parsedBlockFromTxProof = loadBlockExtra(blockExtraCell, {
            cs: 0,
            ref: 0,
        });

        const accountBlocks = parsedBlockFromTxProof.account_blocks.map;
        let foundWantedTxHash = false;
        console.log(parsedBlockFromTxProof.account_blocks)
        for (const entry of accountBlocks.entries()) {
            const txs = entry[1].value.transactions;
            console.log(txs)
            for (const [_key, tx] of txs.entries()) {
                console.log(_key)
            }
        }
        
        // Prove that the transaction proof is related to our verified block
        const txProofHash = txProofFirstRef.hashes[0];
        // console.log("1:", Buffer.from(blockHeader.id.rootHash).toString('hex'))
        // console.log("2:", Buffer.from(txProofHash).toString('hex'))
        //44477283723053006053453491358860383818778593468817379682038688175347672068976
        const result = await transactionChecker.sendCheckTransaction(deployer.getSender(), txWithProof, blockHeader, block, signatures);
        // expect(result.transactions).toHaveTransaction({
        //     from: transactionChecker.address,
        //     to: liteClient.address,
        //     deploy: true,
        //     success: true,
        // });
        expect ((await transactionChecker.getKey(0n)).toString()).toBe(deployer.address.toString())
        // await transactionChecker.sendCorrect(liteClient.getSender());
        // expect ((await transactionChecker.getKey(0n)).toString()).toBe("0")
    });

    it('should reject', async () => {
        await transactionChecker.sendCheckTransaction(deployer.getSender(), txWithProof, blockHeader, block, signatures);
        expect ((await transactionChecker.getKey(0n)).toString()).toBe(deployer.address.toString())
        // await transactionChecker.sendReject(lt.getSender());
        // expect ((await transactionChecker.getKey(0n)).toString()).toBe("0")
    });
});
