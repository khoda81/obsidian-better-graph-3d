
import { ItemView, MetadataCache, TFile, WorkspaceLeaf } from "obsidian";
import createLayout, { Layout } from 'ngraph.forcelayout';
import createGraph, { Graph, NodeId } from "ngraph.graph";
import * as ngraph from "ngraph.graph";
import Graph3DRenderer from "./Graph3DRenderer";
import { Color } from "three";

export const VIEW_TYPE_GRAPH3D = "graph-3d-view";

export type GraphNodeData = { label: string, resolved: boolean };
export type VaultGraph = Graph<GraphNodeData, number>;

class Graph3DLayout {
	labelToIndex: Map<string, number>;
	layout: Layout<VaultGraph>;

	constructor() {
		this.labelToIndex = new Map();
		const graph = createGraph();
		this.layout = createLayout(graph, {
			dimensions: 3,
			timeStep: 1.0,
			gravity: -1,
			theta: 0.5,
			springLength: 5,
			springCoefficient: 0.2,
			dragCoefficient: 0.8,
		});
	}

	get graph(): Graph<GraphNodeData, number> {
		return this.layout.graph;
	}

	createRandomGraph(numNodes: number, desiredAverageDegree = 0.59, allConnected = false) {
		for (let index = 0; index < numNodes; index++) {
			this.addOrGetNode({ label: index.toString(), resolved: true });
		}

		// Critical parameter: average degree (determines percolation phase)
		const connectionProbability = desiredAverageDegree / (numNodes - 1);

		this.graph.forEachNode(source => {
			const count = this.graph.getLinkCount();
			this.graph.forEachNode(target => {
				if (source !== target && Math.random() < connectionProbability) {
					this.link(source.id, target.id);
				}
			});

			if (allConnected && this.graph.getLinkCount() - count === 0) {
				const targetId = Math.floor(Math.random() * numNodes);
				if (source.id !== targetId) {
					this.link(source.id, targetId);
				}
			}
		});

		return this;
	}

	fromMetadataCache(metadataCache: MetadataCache) {
		this.addLinks(metadataCache.resolvedLinks, true);
		this.addLinks(metadataCache.unresolvedLinks, false);

		return this;
	}

	private addLinks(links: Record<string, Record<string, number>>, resolved: boolean) {
		for (const [sourceFile, targets] of Object.entries(links)) {
			const sourceId = this.addOrGetNode({ label: sourceFile, resolved: true }).id;

			for (const [targetFile] of Object.entries(targets)) {
				const targetIndex = this.addOrGetNode({ label: targetFile, resolved }).id;
				this.link(sourceId, targetIndex);
			}
		}
	}

	syncWithCache(metadataCache: MetadataCache) {
		// Add new nodes and update existing ones
		this.fromMetadataCache(metadataCache);

		// Update links
		this.graph.forEachNode(source => this.syncNodeWithCache(metadataCache, source));
	}

	syncNodeWithCache(metadataCache: MetadataCache, source: ngraph.Node<GraphNodeData>) {
		const sourceLabel = source.data.label;
		const resolvedTargets = metadataCache.resolvedLinks[sourceLabel] || {};
		const unresolvedTargets = metadataCache.unresolvedLinks[sourceLabel] || {};

		for (const targetFile of Object.keys(resolvedTargets)) {
			const targetId = this.addOrGetNode({ label: targetFile, resolved: true }).id;
			if (!this.graph.hasLink(source.id, targetId)) {
				this.link(source.id, targetId);
			}
		}

		for (const targetFile of Object.keys(unresolvedTargets)) {
			const targetId = this.addOrGetNode({ label: targetFile, resolved: false }).id;
			if (!this.graph.hasLink(source.id, targetId)) {
				this.link(source.id, targetId);
			}
		}

		const allTargets = { ...resolvedTargets, ...unresolvedTargets };
		const nodeHandler = (target: ngraph.Node<GraphNodeData>, link: ngraph.Link<number>) => {
			const targetFile = this.graph.getNode(target.id)?.data.label;
			if (targetFile && !allTargets[targetFile]) {
				this.graph.removeLink(link);
			}
		};

		// Remove links that no longer exist
		this.graph.forEachLinkedNode(source.id, nodeHandler, true);
	}

	getFileNode(label: string) {
		const nodeId = this.labelToIndex.get(label);
		if (nodeId) {
			return this.graph.getNode(nodeId);
		}
	}

	addOrGetNode(nodeData: GraphNodeData) {
		let nodeId = this.labelToIndex.get(nodeData.label);

		if (nodeId === undefined) {
			nodeId = this.graph.getNodeCount();
		}

		const node = this.graph.addNode(nodeId, nodeData);
		this.labelToIndex.set(nodeData.label, nodeId);

		return node;
	}

	private link(sourceId: NodeId, targetIndex: NodeId) {
		if (!this.graph.hasLink(sourceId, targetIndex)) {
			this.graph.addLink(sourceId, targetIndex, 2 * this.graph.getLinkCount());
		}
	}
}

export class Graph3DView extends ItemView {
	private animationFrameId: number;
	private renderer: Graph3DRenderer;
	private layout: Graph3DLayout;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_GRAPH3D;
	}

	getDisplayText() {
		return "3D Graph View";
	}

	async onOpen() {
		this.headerEl.style.background = "transparent";
		this.contentEl.empty();

		this.contentEl.style.padding = '0';
		this.contentEl.style.overflow = 'hidden';
		this.contentEl.style.position = 'relative';

		// Initialize renderer with container
		this.renderer = new Graph3DRenderer(this.contentEl);

		// Graph generation
		this.layout = new Graph3DLayout().fromMetadataCache(this.app.metadataCache);
		console.log(this.layout.graph.getNodeCount(), this.layout.graph.getLinkCount(), "Initialized");

		// Initialize meshes
		this.renderer.initializeBuffers(this.layout.graph.getNodeCount(), this.layout.graph.getLinkCount());

		// Setup node colors and labels
		this.layout.graph.forEachNode(node => this.updateRendererNode(node));

		this.registerEvent(
			this.app.metadataCache.on("resolved", () => this.onMetadataCacheResolved())
		);

		this.registerEvent(
			this.app.metadataCache.on("resolve", (file) => this.omMetadataCacheResolve(file))
		);

		// Animation loop
		const animate = () => {
			this.animationFrameId = requestAnimationFrame(animate);

			this.layout.layout.step();

			this.renderer.stats.begin();
			this.renderer.updateViewSize();

			this.renderer.updateNodePositions(this.layout.layout);
			this.renderer.updateLinkPositions(this.layout.layout);

			this.renderer.render();
			this.renderer.stats.end();
		};

		animate();
	}

	private omMetadataCacheResolve(file: TFile) {
		const source = this.layout.addOrGetNode({ label: file.path, resolved: true });

		this.updateRendererNode(source);
		this.layout.syncNodeWithCache(this.app.metadataCache, source);

		// console.log(this.layout.graph.getNodeCount(), this.layout.graph.getLinkCount(), "Resolve", file);
	}

	private onMetadataCacheResolved() {
		this.layout.syncWithCache(this.app.metadataCache);
		this.layout.graph.forEachNode(node => this.updateRendererNode(node));

		// console.log(this.layout.graph.getNodeCount(), this.layout.graph.getLinkCount(), "Resolved");
	}

	private updateRendererNode(node: ngraph.Node<GraphNodeData>) {
		const color = node.data.resolved ? 0xffffff : 0x404040;
		const nodeId = node.id as number;

		this.renderer.setNodeColor(nodeId, new Color(color));
		this.renderer.setNodeLabel(nodeId, node.data.label);
	}

	async onClose() {
		cancelAnimationFrame(this.animationFrameId);
		this.renderer.dispose();
	}
}
