/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const util = require("util");
const { RawSource, ReplaceSource } = require("webpack-sources");
const Generator = require("../Generator");
const InitFragment = require("../InitFragment");
const HarmonyCompatibilityDependency = require("../dependencies/HarmonyCompatibilityDependency");

/** @typedef {import("webpack-sources").Source} Source */
/** @typedef {import("../DependenciesBlock")} DependenciesBlock */
/** @typedef {import("../Dependency")} Dependency */
/** @typedef {import("../DependencyTemplates")} DependencyTemplates */
/** @typedef {import("../Generator").GenerateContext} GenerateContext */
/** @typedef {import("../Module")} Module */
/** @typedef {import("../Module").ConcatenationBailoutReasonContext} ConcatenationBailoutReasonContext */
/** @typedef {import("../NormalModule")} NormalModule */
/** @typedef {import("../RuntimeTemplate")} RuntimeTemplate */

// TODO: clean up this file
// replace with newer constructs

const deprecatedGetInitFragments = util.deprecate(
	(template, dependency, templateContext) =>
		template.getInitFragments(dependency, templateContext),
	"DependencyTemplate.getInitFragment is deprecated (use apply(dep, source, { initFragments }) instead)",
	"DEP_WEBPACK_JAVASCRIPT_GENERATOR_GET_INIT_FRAGMENTS"
);

const TYPES = new Set(["javascript"]);

class JavascriptGenerator extends Generator {
	constructor(){
		// ! module 生成掉吗时触发，seal 阶段后期
		super();
	}
	/**
	 * @param {NormalModule} module fresh module
	 * @returns {Set<string>} available types (do not mutate)
	 */
	getTypes(module) {
		return TYPES;
	}

	/**
	 * @param {NormalModule} module the module
	 * @param {string=} type source type
	 * @returns {number} estimate size of the module
	 */
	getSize(module, type) {
		const originalSource = module.originalSource();
		if (!originalSource) {
			return 39;
		}
		return originalSource.size();
	}

	/**
	 * @param {NormalModule} module module for which the bailout reason should be determined
	 * @param {ConcatenationBailoutReasonContext} context context
	 * @returns {string | undefined} reason why this module can't be concatenated, undefined when it can be concatenated
	 */
	getConcatenationBailoutReason(module, context) {
		// Only harmony modules are valid for optimization
		if (
			!module.buildMeta ||
			module.buildMeta.exportsType !== "namespace" ||
			module.presentationalDependencies === undefined ||
			!module.presentationalDependencies.some(
				d => d instanceof HarmonyCompatibilityDependency
			)
		) {
			return "Module is not an ECMAScript module";
		}

		// Some expressions are not compatible with module concatenation
		// because they may produce unexpected results. The plugin bails out
		// if some were detected upfront.
		if (module.buildInfo && module.buildInfo.moduleConcatenationBailout) {
			return `Module uses ${module.buildInfo.moduleConcatenationBailout}`;
		}
	}

	/**
	 * @param {NormalModule} module module for which the code should be generated
	 * @param {GenerateContext} generateContext context for generate
	 * @returns {Source} generated code
	 */
	generate(module, generateContext) {
		const originalSource = module.originalSource();
		if (!originalSource) {
			return new RawSource("throw new Error('No source available');");
		}

		// ! 从 module 取出原始的 source 之后，在后面的处理过程中会不断修改改 source 对象，包括：
		// 1. Dependency 子类中可能会直接修改 source 内容，比如 ConstDependency 中
		// 2. 遍历完 dependencies、presentationalDependencies 后，调用 addToSource 将 initFragments 合并入 source 中
		// 经过 generate 处理后的 source 最终会返回，记录到 compilation.codeGenerationResults 中，之后这个属性又传入 JavascriptModulesPlugin
		// 在 renderModule 函数中返回 module 对应的 source
		// 太绕了
		const source = new ReplaceSource(originalSource);
		const initFragments = [];

		this.sourceModule(module, initFragments, source, generateContext);

		return InitFragment.addToSource(source, initFragments, generateContext);
	}

	/**
	 * ! 记录 module 的信息，包括 dependencies、blocks、presentationalDependencies
	 * @param {Module} module the module to generate
	 * @param {InitFragment[]} initFragments mutable list of init fragments
	 * @param {ReplaceSource} source the current replace source which can be modified
	 * @param {GenerateContext} generateContext the generateContext
	 * @returns {void}
	 */
	sourceModule(module, initFragments, source, generateContext) {
		// ! 这个 dependency 是当前模块对其它模块的依赖
		// 例如 a 文件中包含语句 `import "b.js"`，则 module-a 的 dependencies 数组中包含有 dependency-b 对象
		for (const dependency of module.dependencies) {
			this.sourceDependency(
				module,
				dependency,
				initFragments,
				source,
				generateContext
			);
		}

		// ? presentationalDependencies 是啥？
		if (module.presentationalDependencies !== undefined) {
			for (const dependency of module.presentationalDependencies) {
				this.sourceDependency(
					module,
					dependency,
					initFragments,
					source,
					generateContext
				);
			}
		}

		// ? 不知道什么情况会出现 blocks ，下次可以仔细看看
		for (const childBlock of module.blocks) {
			this.sourceBlock(
				module,
				childBlock,
				initFragments,
				source,
				generateContext
			);
		}
	}

	/**
	 * @param {Module} module the module to generate
	 * @param {DependenciesBlock} block the dependencies block which will be processed
	 * @param {InitFragment[]} initFragments mutable list of init fragments
	 * @param {ReplaceSource} source the current replace source which can be modified
	 * @param {GenerateContext} generateContext the generateContext
	 * @returns {void}
	 */
	sourceBlock(module, block, initFragments, source, generateContext) {
		for (const dependency of block.dependencies) {
			this.sourceDependency(
				module,
				dependency,
				initFragments,
				source,
				generateContext
			);
		}

		for (const childBlock of block.blocks) {
			this.sourceBlock(
				module,
				childBlock,
				initFragments,
				source,
				generateContext
			);
		}
	}

	/**
	 * @param {Module} module the current module
	 * @param {Dependency} dependency the dependency to generate
	 * @param {InitFragment[]} initFragments mutable list of init fragments
	 * @param {ReplaceSource} source the current replace source which can be modified
	 * @param {GenerateContext} generateContext the render context
	 * @returns {void}
	 */
	sourceDependency(module, dependency, initFragments, source, generateContext) {
		const constructor = /** @type {new (...args: any[]) => Dependency} */ (
			dependency.constructor
		);
		const template = generateContext.dependencyTemplates.get(constructor);
		if (!template) {
			throw new Error(
				"No template for dependency: " + dependency.constructor.name
			);
		}

		const templateContext = {
			runtimeTemplate: generateContext.runtimeTemplate,
			dependencyTemplates: generateContext.dependencyTemplates,
			moduleGraph: generateContext.moduleGraph,
			chunkGraph: generateContext.chunkGraph,
			module,
			runtime: generateContext.runtime,
			runtimeRequirements: generateContext.runtimeRequirements,
			concatenationScope: generateContext.concatenationScope,
			initFragments
		};

		// ? sourceDependency 函数最核心的操作就是调用 dep 对应的 depTemplate 的 apply 函数
		// ? 那么，apply 会带来啥副作用？
		// 以 HarmonyImportDependency 为例，从 ../dependencies/HarmonyImportDependency.js:228 的定义来看，似乎只会不断添加 initFragments
		// 以 ConstDependency 为例，似乎是会更改 source 对象的内容
		// 所以大致上可以推断出：
		// 1. 将代码片段插入 initFragments 数组，最终被合并到输出中
		// 2. 修改 source 对象的内容，从而直接更改源码
		// 3. 通过 runtimeRequirements 添加 runtime 依赖
		template.apply(dependency, source, templateContext);

		// TODO remove in webpack 6
		if ("getInitFragments" in template) {
			const fragments = deprecatedGetInitFragments(
				template,
				dependency,
				templateContext
			);

			if (fragments) {
				for (const fragment of fragments) {
					initFragments.push(fragment);
				}
			}
		}
	}
}

module.exports = JavascriptGenerator;
