import { toNano } from '@ton/core';
import { LiteClient } from '../wrappers/LiteClient';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const liteClient = provider.open(LiteClient.createFromConfig({}, await compile('LiteClient'), 0));

    await liteClient.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(liteClient.address);

    // run methods on `liteClient`
}
