import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LiteClient } from '../wrappers/LiteClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as fs from 'fs';
import { liteServer_BlockData } from 'ton-lite-client/dist/schema';
import { liteServer_blockHeader } from 'ton-lite-client/dist/schema';
import { ValidatorSignature } from '@oraichain/tonbridge-utils';
import { Op } from '../wrappers/Constants';

describe('LiteClient', () => {
    let code: Cell;
    let blockData: any;
    let initialData: any;
    let blockHeader: liteServer_blockHeader;
    let initialBlockHeader: liteServer_blockHeader;
    let block: liteServer_BlockData;
    let initialBlock: liteServer_BlockData;
    let signatures: ValidatorSignature[];
    let initialSignatures: ValidatorSignature[];

    beforeAll(async () => {
        code = await compile('LiteClient');

        const initialDataRaw = fs.readFileSync(require.resolve('./keyblock1.json'), 'utf8');
        initialData = JSON.parse(initialDataRaw);

        // initialBlockHeader = {
        //     kind: initialData.header.kind,
        //     id: initialData.header.id,
        //     mode: initialData.header.mode,
        //     headerProof: initialData.header.headerProof,
        // };
        initialBlock = {
            kind: initialData.block.kind,
            id: initialData.block.id,
            data: initialData.block.data,
        };
        // initialSignatures = initialData.signatures;

        const testDataRaw = fs.readFileSync(require.resolve('./keyblock2.json'), 'utf8');
        blockData = JSON.parse(testDataRaw);

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
    let liteClient: SandboxContract<LiteClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

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

        const deployResult = await liteClient.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: liteClient.address,
            deploy: true,
            success: true,
        });
    });

    it('should set three new key blocks', async () => {
        let result = await liteClient.sendNewKeyBlock(deployer.getSender(), blockHeader, block, signatures);
        expect(result.transactions).toHaveTransaction({
            from: liteClient.address,
            to: deployer.address,
            success: true,
            op: Op.ok,
        });

        let testDataRaw = fs.readFileSync(require.resolve('./keyblock3.json'), 'utf8');
        blockData = JSON.parse(testDataRaw);

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

        result = await liteClient.sendNewKeyBlock(deployer.getSender(), blockHeader, block, signatures);
        expect(result.transactions).toHaveTransaction({
            from: liteClient.address,
            to: deployer.address,
            success: true,
            op: Op.ok,
        });

        testDataRaw = fs.readFileSync(require.resolve('./keyblock4.json'), 'utf8');
        blockData = JSON.parse(testDataRaw);

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

        result = await liteClient.sendNewKeyBlock(deployer.getSender(), blockHeader, block, signatures);
        expect(result.transactions).toHaveTransaction({
            from: liteClient.address,
            to: deployer.address,
            success: true,
            op: Op.ok,
        });
    });
});
