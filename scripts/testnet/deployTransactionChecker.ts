import { Address, toNano } from '@ton/core';
import { LiteClient } from '../../wrappers/LiteClient';
import { compile, NetworkProvider } from '@ton/blueprint';
import fs from 'fs';
import { TransactionChecker } from '../../wrappers/TransactionChecker';

export async function run(provider: NetworkProvider) {
    const transactionCheckerCode = await compile('TransactionChecker');
    const workchain = 0;
    const blocksWorkchain = -1;

    const liteClient = LiteClient.createFromAddress(Address.parse('kQCPAjpID4kOV-_CuCa929zDjUpRbHdJJtW-KqOG2hwVroTC'));

    const transactionChecker = provider.open(
        TransactionChecker.createFromConfig(
            {
                lite_client: liteClient.address,
                queries_cnt: 0n,
            },
            transactionCheckerCode,
            workchain,
        ),
    );

    await transactionChecker.sendDeploy(provider.sender(), toNano('0.05'));
    await provider.waitForDeploy(transactionChecker.address);
}
