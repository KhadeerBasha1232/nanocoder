import {performance} from 'node:perf_hooks';
import {parseToolCalls, stripThinkTags} from './source/tool-calling/tool-parser.ts';

const prose = 'Use the <think> tag to reason. Then done.';
const fileBody = 'Models emit <think>reasoning</think> blocks.';
const xml = `<write_file><path>doc.md</path><content>${fileBody}</content></write_file>`;
const json = JSON.stringify({name: 'write_file', arguments: {path: 'doc.md', content: fileBody}});
const plain = 'Here is the final answer.';
const leading = `<think>Model reasoning.</think>${plain}`;
const readContent = result => result.success ? result.toolCalls[0]?.function.arguments.content ?? result.cleanedContent : result.error;
const results = {
	prose: stripThinkTags(prose),
	xml: readContent(parseToolCalls(xml, ['write_file'])),
	json: readContent(parseToolCalls(json, ['write_file'])),
	leading: stripThinkTags(leading),
};

function measure(fn, iterations) {
	let observed = 0;
	for (let index = 0; index < 2000; index++) observed += fn().length;
	const samples = [];
	for (let sample = 0; sample < 7; sample++) {
		const start = performance.now();
		for (let index = 0; index < iterations; index++) observed += fn().length;
		samples.push((performance.now() - start) * 1000 / iterations);
	}
	if (!observed) throw new Error('Benchmark collected no output.');
	samples.sort((left, right) => left - right);
	return Number(samples[3].toFixed(3));
}

console.log(JSON.stringify({
	results,
	medianMicroseconds: {
		plain: measure(() => stripThinkTags(plain), 200_000),
		leading: measure(() => stripThinkTags(leading), 200_000),
		xml: measure(() => readContent(parseToolCalls(xml, ['write_file'])), 20_000),
		json: measure(() => readContent(parseToolCalls(json, ['write_file'])), 20_000),
	},
}));
