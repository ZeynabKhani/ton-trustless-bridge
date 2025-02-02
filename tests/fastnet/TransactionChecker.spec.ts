import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LiteClient } from '../../wrappers/LiteClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as fs from 'fs';
import { liteServer_BlockData } from 'ton-lite-client/dist/schema';
import { liteServer_blockHeader } from 'ton-lite-client/dist/schema';
import TonRocks, { ValidatorSignature } from '@oraichain/tonbridge-utils';
import { TransactionChecker } from '../../wrappers/TransactionChecker';
import { Cell as TonRocksCell } from '@oraichain/tonbridge-utils/build/types/Cell';
import { loadBlockExtra } from '@oraichain/tonbridge-utils/build/blockchain/BlockParser';
import { Op } from '../../wrappers/Constants';

describe.only('TransactionChecker', () => {

    let transactionChecker: SandboxContract<TransactionChecker>;
    let code: Cell;
    let blockData: any;
    let initialData: any;
    let blockHeader: liteServer_blockHeader;
    let block: liteServer_BlockData;
    let initialBlock: liteServer_BlockData;
    let signatures: ValidatorSignature[];
    const workchain = -1;
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let liteClient: SandboxContract<LiteClient>;
    let txData: any;
    let txWithProof: any;

    beforeAll(async () => {
        // Load the test data
        const txDataRaw = fs.readFileSync(require.resolve('../testnet/txData.json'), 'utf8');
        txData = JSON.parse(txDataRaw);
        txWithProof = {
            kind: txData.kind,
            id: txData.id,
            proof: txData.proof,
            transaction: txData.transaction,
        };

        const blockDataRaw = fs.readFileSync(require.resolve('../testnet/keyblock2.json'), 'utf8');
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


    beforeEach(async () => {
        blockchain = await Blockchain.create();
        
        code = await compile('TestnetLiteClient');

        const initialDataRaw = fs.readFileSync(require.resolve('../testnet/keyblock1.json'), 'utf8');
        let initialData = JSON.parse(initialDataRaw);

        initialBlock = {
            kind: initialData.block.kind,
            id: initialData.block.id,
            data: initialData.block.data,
        };
        
        const { curValidatorSet, prevValidatorSet, nextValidatorSet, utime_since, utime_until } =
            LiteClient.getInitialDataConfig(initialBlock, workchain);
        
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
                0, // todo: this should be -1
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

        code = await compile('TransactionChecker');

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
        // TODO - this is not working
        // let result = await liteClient.sendNewKeyBlock(deployer.getSender(), blockHeader, block, signatures, workchain);
        // expect(result.transactions).toHaveTransaction({
        //     from: liteClient.address,
        //     to: deployer.address,
        //     success: true,
        //     op: Op.ok,
        // });

        let result2 = await transactionChecker.sendCheckTransaction(deployer.getSender(), txWithProof, blockHeader, block, signatures);
        expect(result2.transactions).toHaveTransaction({
            from: transactionChecker.address,
            to: deployer.address,
            op: Op.transaction_checked,
            success: true,
        });
    });

    // it('should reject', async () => {
    //     await transactionChecker.sendCheckTransaction(deployer.getSender(), txWithProof, blockHeader, block, signatures);
    //     expect ((await transactionChecker.getKey(0n)).toString()).toBe(deployer.address.toString())
    //     // await transactionChecker.sendReject(lt.getSender());
    //     // expect ((await transactionChecker.getKey(0n)).toString()).toBe("0")
    // });
});
