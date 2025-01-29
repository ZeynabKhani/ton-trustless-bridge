import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LiteClient } from '../wrappers/LiteClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as fs from 'fs';
import { liteServer_BlockData } from 'ton-lite-client/dist/schema';
import { liteServer_blockHeader } from 'ton-lite-client/dist/schema';
import { ValidatorSignature } from '@oraichain/tonbridge-utils';

describe('LiteClient', () => {
    let code: Cell;
    let blockData: any;
    let blockHeader: liteServer_blockHeader;
    let block: liteServer_BlockData;
    let signatures: ValidatorSignature[];

    beforeAll(async () => {
        code = await compile('LiteClient');
        // Load the test data
        const testDataRaw = fs.readFileSync(require.resolve('./block.json'), 'utf8');
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

        liteClient = blockchain.openContract(LiteClient.createFromConfig({ workchain: 0 }, code, 0));

        deployer = await blockchain.treasury('deployer');

        const deployResult = await liteClient.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: liteClient.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        await liteClient.sendNewKeyBlock(deployer.getSender(), blockHeader, block, signatures);
    });
});
