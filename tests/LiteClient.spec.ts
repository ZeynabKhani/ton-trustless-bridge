import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LiteClient } from '../wrappers/LiteClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

describe('LiteClient', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('LiteClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let liteClient: SandboxContract<LiteClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        liteClient = blockchain.openContract(LiteClient.createFromConfig({}, code));

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
        // the check is done inside beforeEach
        // blockchain and liteClient are ready to use
    });
});
