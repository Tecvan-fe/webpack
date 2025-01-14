/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const { ConcatSource, PrefixSource } = require("webpack-sources");
const InitFragment = require("./InitFragment");
const Template = require("./Template");
const { mergeRuntime } = require("./util/runtime");

/** @typedef {import("webpack-sources").Source} Source */
/** @typedef {import("./Generator").GenerateContext} GenerateContext */
/** @typedef {import("./util/runtime").RuntimeSpec} RuntimeSpec */

const wrapInCondition = (condition, source) => {
	if (typeof source === "string") {
		return Template.asString([
			`if (${condition}) {`,
			Template.indent(source),
			"}",
			""
		]);
	} else {
		return new ConcatSource(
			`if (${condition}) {\n`,
			new PrefixSource("\t", source),
			"}\n"
		);
	}
};

class ConditionalInitFragment extends InitFragment {
	/**
	 * @param {string|Source} content the source code that will be included as initialization code
	 * @param {number} stage category of initialization code (contribute to order)
	 * @param {number} position position in the category (contribute to order)
	 * @param {string} key unique key to avoid emitting the same initialization code twice
	 * @param {RuntimeSpec | boolean} runtimeCondition in which runtime this fragment should be executed
	 * @param {string|Source=} endContent the source code that will be included at the end of the module
	 */
	constructor(
		content,
		stage,
		position,
		key,
		runtimeCondition = true,
		endContent
	) {
		super(content, stage, position, key, endContent);
		this.runtimeCondition = runtimeCondition;
	}

	/**
	 * @param {GenerateContext} generateContext context for generate
	 * @returns {string|Source} the source code that will be included as initialization code
	 */
	getContent(generateContext) {
		if (this.runtimeCondition === false || !this.content) return "";
		if (this.runtimeCondition === true) return this.content;
		const expr = generateContext.runtimeTemplate.runtimeConditionExpression({
			chunkGraph: generateContext.chunkGraph,
			runtimeRequirements: generateContext.runtimeRequirements,
			runtime: generateContext.runtime,
			runtimeCondition: this.runtimeCondition
		});
		if (expr === "true") return this.content;
		return wrapInCondition(expr, this.content);
	}

	/**
	 * @param {GenerateContext} generateContext context for generate
	 * @returns {string|Source=} the source code that will be included at the end of the module
	 */
	getEndContent(generateContext) {
		if (this.runtimeCondition === false || !this.endContent) return "";
		if (this.runtimeCondition === true) return this.endContent;
		const expr = generateContext.runtimeTemplate.runtimeConditionExpression({
			chunkGraph: generateContext.chunkGraph,
			runtimeRequirements: generateContext.runtimeRequirements,
			runtime: generateContext.runtime,
			runtimeCondition: this.runtimeCondition
		});
		if (expr === "true") return this.endContent;
		return wrapInCondition(expr, this.endContent);
	}

	merge(other) {
		// ! WTF...这啥时候能跳过这几个判断语句啊
		if (this.runtimeCondition === true) return this;
		if (other.runtimeCondition === true) return other;
		if (this.runtimeCondition === false) return other;
		if (other.runtimeCondition === false) return this;
		const runtimeCondition = mergeRuntime(
			this.runtimeCondition,
			other.runtimeCondition
		);
		return new ConditionalInitFragment(
			this.content,
			this.stage,
			this.position,
			this.key,
			runtimeCondition,
			this.endContent
		);
	}
}

module.exports = ConditionalInitFragment;
