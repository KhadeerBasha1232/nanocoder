import {Buffer} from 'node:buffer';
import React from 'react';
import {render} from 'ink-testing-library';
import {dispatchSlashCommand} from '@/app/utils/command-dispatcher';
import {commandRegistry} from '@/commands';
import {retryCommand} from '@/commands/retry';
import {useChatHandler} from '@/hooks/chat-handler/useChatHandler';
import type {ChatHandlerReturn} from '@/hooks/chat-handler/types';
import type {LLMClient, Message, MessageSubmissionOptions} from '@/types/index';

commandRegistry.register(retryCommand);

async function capture(initial: Message[], retries: number) {
	let stored = initial;
	let hook: ChatHandlerReturn;
	const requests: Message[][] = [];
	const client = {
		getCurrentModel: () => 'test-model',
		getContextSize: () => 0,
		getTimeout: () => undefined,
		chat: async (messages, _tools, callbacks) => {
			requests.push(messages.filter(message => message.role !== 'system'));
			callbacks.onFinish?.();
			return {
				choices: [{message: {role: 'assistant', content: 'Replacement reply.'}}],
			};
		},
	} as LLMClient;
	const toolManager = {
		getAvailableToolNames: () => ['read_file'],
		getToolNames: () => ['read_file'],
		getFilteredTools: () => ({}),
		getFilteredToolsForProvider: () => ({}),
	} as Parameters<typeof useChatHandler>[0]['toolManager'];
	function Harness({messages}: {messages: Message[]}) {
		hook = useChatHandler({
			client,
			toolManager,
			customCommandLoader: null,
			messages,
			setMessages: updated => { stored = updated; },
			currentProvider: 'test-provider',
			currentModel: 'test-model',
			setIsCancelling: () => {},
			addToChatQueue: () => {},
			abortController: null,
			setAbortController: () => {},
		});
		return null;
	}
	const app = render(<Harness messages={stored} />);
	try {
		for (let index = 0; index < retries; index++) {
			app.rerender(<Harness messages={stored} />);
			const options = {
				messages: stored,
				provider: 'test-provider',
				model: 'test-model',
				client,
				onHandleChatMessage: hook!.handleChatMessage,
				onAddToChatQueue: () => {},
				setLiveComponent: () => {},
				customCommandCache: new Map(),
			} as unknown as MessageSubmissionOptions;
			await dispatchSlashCommand('/retry', options);
		}
	} finally {
		app.unmount();
		app.cleanup();
	}
	if (requests.length !== retries) throw new Error('Unexpected request count');
	return {
		request: requests[0].map(({role, content}) => [role, content]),
		stored: stored.map(({role, content}) => [role, content]),
		requestMessageCounts: requests.map(request => request.length),
		requestJsonBytes: requests.map(request => Buffer.byteLength(JSON.stringify(request))),
	};
}

const turn: Message[] = [
	{role: 'user', content: 'What package manager does this repo use?'},
	{role: 'assistant', content: 'pnpm.'},
	{role: 'user', content: 'Check the build.'},
	{role: 'assistant', content: '', tool_calls: [
		{id: 'read-1', function: {name: 'read_file', arguments: {path: 'build.log'}}},
	]},
	{role: 'tool', name: 'read_file', tool_call_id: 'read-1', content: 'Build log from the previous attempt.'},
	{role: 'assistant', content: 'Old reply.'},
];
const output: Message = {
	role: 'user',
	content: 'Bash command output:\n```\n$ git status\nworking tree clean\n```',
};
const result = {
	replay: await capture(turn, 1),
	shell: await capture([...turn, output], 1),
	repeated: await capture(turn, 5),
};
process.stdout.write(JSON.stringify(result) + '\n');
