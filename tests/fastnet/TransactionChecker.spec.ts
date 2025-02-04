import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LiteClient } from '../../wrappers/LiteClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as fs from 'fs';
import { liteServer_BlockData } from 'ton-lite-client/dist/schema';
import { liteServer_blockHeader } from 'ton-lite-client/dist/schema';
import { ValidatorSignature } from '@oraichain/tonbridge-utils';
import { TransactionChecker } from '../../wrappers/TransactionChecker';
import { Op } from '../../wrappers/Constants';

describe('TransactionChecker', () => {
    let transactionChecker: SandboxContract<TransactionChecker>;
    let transactionCheckerCode: Cell;
    let liteClientCode: Cell;
    let blockData: any;
    let blockHeader: liteServer_blockHeader;
    let block: liteServer_BlockData;
    let initialBlock: liteServer_BlockData;
    let signatures: ValidatorSignature[];
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let liteClient: SandboxContract<LiteClient>;
    let txData: any;
    let txWithProof: any;
    const workchain = -1;

    beforeAll(async () => {
        liteClientCode = await compile('TestnetLiteClient');
        transactionCheckerCode = await compile('TransactionChecker');
    });

    beforeEach(async () => {
        blockchain = await Blockchain.create();

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
                    seqno: initialBlock.id.seqno,
                },
                liteClientCode,
                workchain,
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

        transactionChecker = blockchain.openContract(
            TransactionChecker.createFromConfig(
                {
                    lite_client: liteClient.address,
                    query_id: 0,
                    check_transaction_requests: Cell.EMPTY,
                },
                transactionCheckerCode,
                workchain,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        deployResult = await transactionChecker.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: transactionChecker.address,
            deploy: true,
            success: true,
        });
    });

    it('should check transaction from a transitioning key block', async () => {
        const blockDataRaw = fs.readFileSync(require.resolve('../testnet/keyblock1.json'), 'utf8');
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

        const txDataRaw = fs.readFileSync(require.resolve('../testnet/txDataFromKeyBlock1.json'), 'utf8');
        txData = JSON.parse(txDataRaw);
        txWithProof = {
            transaction: txData.transaction,
            proof: txData.proof,
            // currentBlock: txData.currentBlock,
        };

        let result = await transactionChecker.sendCheckTransaction(
            deployer.getSender(),
            txWithProof,
            signatures,
            workchain,
            toNano('5'),
        );
        // expect(result.transactions).toHaveTransaction({
        //     from: transactionChecker.address,
        //     to: deployer.address,
        //     op: Op.transaction_checked,
        //     success: true,
        // });
    });

    // it('should check transaction from a key block that starts a new epoch', async () => {
    //     const blockDataRaw = fs.readFileSync(require.resolve('../testnet/keyblock2.json'), 'utf8');
    //     blockData = JSON.parse(blockDataRaw);

    //     blockHeader = {
    //         kind: blockData.header.kind,
    //         id: blockData.header.id,
    //         mode: blockData.header.mode,
    //         headerProof: blockData.header.headerProof,
    //     };
    //     block = {
    //         kind: blockData.block.kind,
    //         id: blockData.block.id,
    //         data: blockData.block.data,
    //     };
    //     signatures = blockData.signatures;
    //     let result = await liteClient.sendNewKeyBlock(
    //         deployer.getSender(),
    //         blockHeader,
    //         block,
    //         signatures,
    //         workchain,
    //         toNano('1.5'),
    //     );
    //     expect(result.transactions).toHaveTransaction({
    //         from: liteClient.address,
    //         to: deployer.address,
    //         success: true,
    //         op: Op.ok,
    //     });

    //     const txDataRaw = fs.readFileSync(require.resolve('../testnet/txDataFromKeyBlock2.json'), 'utf8');
    //     txData = JSON.parse(txDataRaw);
    //     txWithProof = {
    //         transaction: txData.transaction,
    //         proof: txData.proof,
    //         currentBlock: txData.currentBlock,
    //     };

    //     let result2 = await transactionChecker.sendCheckTransaction(
    //         deployer.getSender(),
    //         txWithProof,
    //         blockHeader,
    //         block,
    //         signatures,
    //         workchain,
    //         toNano('4.5'),
    //     );
    //     expect(result2.transactions).toHaveTransaction({
    //         from: transactionChecker.address,
    //         to: deployer.address,
    //         op: Op.transaction_checked,
    //         success: true,
    //     });
    // });

    // it('should reject', async () => {
    //     await transactionChecker.sendCheckTransaction(
    //         deployer.getSender(),
    //         txWithProof,
    //         blockHeader,
    //         block,
    //         signatures,
    //         workchain,
    //         toNano('4.5'),
    //     );
    //     expect((await transactionChecker.getKey(0n)).toString()).toBe(deployer.address.toString());
    //     // await transactionChecker.sendReject(lt.getSender());
    //     // expect ((await transactionChecker.getKey(0n)).toString()).toBe("0")
    // });
});
