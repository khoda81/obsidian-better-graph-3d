import Stats from 'stats.js'
import { ItemView, MetadataCache, WorkspaceLeaf } from "obsidian";
import * as THREE from "three";
import { ArcballControls } from 'three/addons/controls/ArcballControls.js';
import createLayout, { Layout } from 'ngraph.forcelayout';
import createGraph, { Graph, NodeId } from "ngraph.graph";


export const VIEW_TYPE_GRAPH3D = "graph-3d-view";

type GraphNode = { name: string, resolved: boolean, labelSprite?: THREE.Sprite };
type VaultGraph = Graph<GraphNode, number>;

class Graph3DLayout {
	nameToId: Map<string, NodeId>;
	graph: VaultGraph
	layout: Layout<VaultGraph>

	constructor() {
		this.nameToId = new Map();
		this.graph = createGraph();
		this.layout = createLayout(this.graph, {
			dimensions: 3,
			timeStep: 0.5,
			gravity: -1,
			theta: 0.8,
			springLength: 5,
			springCoefficient: 0.2,
			dragCoefficient: 0.8,
		});
	}

	createRandomGraph(numNodes: number, desiredAverageDegree = 0.59, allConnected = false) {
		for (let index = 0; index < numNodes; index++) { this.addOrGetNode({ name: index.toString(), resolved: true }) }

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
				if (source.id !== targetId) { this.link(source.id, targetId) }
			}
		});

		return this;
	}

	fromMetadataCache(metadataCache: MetadataCache) {
		this.addLinks(metadataCache.resolvedLinks, true);
		this.addLinks(metadataCache.unresolvedLinks, false);
	}

	private addLinks(links: Record<string, Record<string, number>>, resolved: boolean) {
		for (const [sourceFile, targets] of Object.entries(links)) {
			const sourceId = this.addOrGetNode({ name: sourceFile, resolved: true });

			for (const [targetFile] of Object.entries(targets)) {
				const targetIndex = this.addOrGetNode({ name: targetFile, resolved });
				this.link(sourceId, targetIndex);
			}
		}
	}

	private addOrGetNode(node: GraphNode) {
		const cachedId = this.nameToId.get(node.name);
		if (cachedId !== undefined) {
			return cachedId;
		}

		const nodeId = this.graph.getNodeCount();
		this.graph.addNode(nodeId, node);
		this.nameToId.set(node.name, nodeId);

		return nodeId;
	}

	private link(sourceId: NodeId, targetIndex: NodeId) {
		if (!this.graph.hasLink(sourceId, targetIndex)) {
			this.graph.addLink(sourceId, targetIndex, 2 * this.graph.getLinkCount());
		}
	}
}

export class Graph3DView extends ItemView {
	private animationFrameId: number;
	private renderer: THREE.WebGLRenderer;
	private layout: Graph3DLayout;
	private raycaster: THREE.Raycaster;
	private selectedNodeId: number | undefined = undefined;

	private instancedSpheres: THREE.InstancedMesh
	private linkMesh: THREE.LineSegments

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

		// Scene setup
		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(60, this.contentEl.clientWidth / this.contentEl.clientHeight, 0.1, 10000);
		camera.position.z = 200;

		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setSize(this.contentEl.clientWidth, this.contentEl.clientHeight);
		this.renderer.shadowMap.enabled = true;

		this.containerEl.appendChild(this.renderer.domElement);
		this.renderer.domElement.style.width = "100%";
		this.renderer.domElement.style.height = "100%";
		this.renderer.domElement.style.position = "absolute";

		const controls = new ArcballControls(camera, this.renderer.domElement, scene);
		controls.cursorZoom = true;
		controls.setGizmosVisible(false);

		// Graph generation
		this.layout = new Graph3DLayout();
		this.layout.fromMetadataCache(this.app.metadataCache);

		// this.registerEvent(
		// 	this.app.metadataCache.on("resolved", () => this.layout.fromMetadataCache(this.app.metadataCache))
		// );

		this.registerEvent(
			this.app.metadataCache.on("resolve", (file) => {
				// Implement removing/changing nodes/links
				this.layout.fromMetadataCache(this.app.metadataCache);
			})
		)

		scene.add(new THREE.AmbientLight(0x808080));
		const light = new THREE.DirectionalLight(0xffffff, 1);
		light.position.set(5, 0, 0);
		scene.add(light);

		// Node and link visualization
		const linkMaterial = new THREE.LineBasicMaterial({ color: 0xa0a0a0, transparent: true, opacity: 0.6 });
		const sphereMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });

		this.instancedSpheres = createNodeMesh(this.layout.graph.getNodeCount(), sphereMaterial);
		scene.add(this.instancedSpheres);

		this.linkMesh = createLinkGeometry(this.layout.graph.getLinkCount(), linkMaterial);
		scene.add(this.linkMesh);

		const updateSceneBuffers = () => {
			const sphereBufferCapacity = this.instancedSpheres.instanceMatrix.array.length / 16;
			if (this.layout.graph.getNodeCount() > sphereBufferCapacity) {
				// TODO: try only changing the instanceMatrix instead
				scene.remove(this.instancedSpheres);
				this.instancedSpheres.dispose();

				this.instancedSpheres = createNodeMesh(2 * sphereBufferCapacity, sphereMaterial);
				scene.add(this.instancedSpheres);
			}

			const linkBufferCapacity = this.linkMesh.geometry.getAttribute('position').count;
			if (this.layout.graph.getLinkCount() * 2 > linkBufferCapacity) {
				scene.remove(this.linkMesh);
				this.linkMesh.geometry.dispose();

				this.linkMesh = createLinkGeometry(2 * linkBufferCapacity, linkMaterial);
				scene.add(this.linkMesh);
			}
		}

		// Give instances random colors
		this.layout.graph.forEachNode(node => {
			const color = node.data.resolved ? 0xffffff * Math.random() : 0x404040;
			this.instancedSpheres.setColorAt(node.id as number, new THREE.Color(color))
		});

		const stats = new Stats();
		stats.showPanel(0);
		stats.dom.style.position = 'absolute';
		stats.dom.style.top = '10px';
		stats.dom.style.right = '10px';
		stats.dom.style.left = 'auto';
		this.contentEl.appendChild(stats.dom);

		this.layout.graph.forEachNode(node => {
			const labelCanvas = makeLabelCanvas(this.contentEl, node.data.name as string);
			node.data.labelSprite = createLabelMesh(labelCanvas);
			scene.add(node.data.labelSprite);
		});

		// Animation loop
		const animate = () => {
			this.animationFrameId = requestAnimationFrame(animate);

			stats.begin();
			this.updateViewSize(this.renderer, camera);
			updateSceneBuffers();

			this.layout.layout.step();
			this.layout.layout.forEachBody((body, nodeId) => {
				const position = new THREE.Vector3(body.pos.x, body.pos.y, body.pos.z ?? 0);
				const matrix = new THREE.Matrix4().makeTranslation(position);

				this.instancedSpheres.setMatrixAt(nodeId as number, matrix)
				const labelSprite = this.layout.graph.getNode(nodeId)?.data.labelSprite;
				if (labelSprite) {
					labelSprite.position.copy(position);
					labelSprite.geometry.computeBoundingSphere();
				}
			});

			this.instancedSpheres.count = this.layout.graph.getNodeCount();
			this.instancedSpheres.instanceMatrix.needsUpdate = true;
			this.instancedSpheres.computeBoundingSphere();

			const linePositionAttribute = this.linkMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
			this.layout.graph.forEachLink((link) => {
				const { from, to } = this.layout.layout.getLinkPosition(link.id);

				linePositionAttribute.setXYZ(link.data, from.x, from.y, from.z ?? 0);
				linePositionAttribute.setXYZ(link.data + 1, to.x, to.y, to.z ?? 0);
			});

			this.linkMesh.geometry.setDrawRange(0, 2 * this.layout.graph.getLinkCount());
			linePositionAttribute.needsUpdate = true
			this.linkMesh.geometry.computeBoundingSphere();

			this.renderer.render(scene, camera);

			stats.end();
		};

		animate();
	}

	private updateViewSize(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
		const canvas = renderer.domElement;
		camera.aspect = canvas.clientWidth / canvas.clientHeight;
		camera.updateProjectionMatrix();

		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		const needResize = canvas.width !== width || canvas.height !== height;
		if (needResize) {
			renderer.setSize(width, height, false);
		}

		return needResize;
	}

	async onClose() {
		cancelAnimationFrame(this.animationFrameId);
		this.renderer.dispose();
	}
}

function createLabelMesh(canvas: HTMLCanvasElement) {
	const texture = new THREE.CanvasTexture(canvas);
	texture.matrix.translate(10.5, 100);
	// texture.offset.set(0.5, 0);

	const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
	const sprite = new THREE.Sprite(material);
	sprite.scale.set(canvas.width / 100, canvas.height / 100, 1);
	sprite.center.set(0.5, -2.5);

	return sprite;
}

// Create a label for node
function makeLabelCanvas(container: Node, text: string) {
	const canvas = container.createEl("canvas", { cls: "graph-3d-node-canvas" });
	const ctx = canvas.getContext('2d')!;

	ctx.font = '48px sans-serif';
	const metrics = ctx.measureText(text);

	canvas.width = metrics.width + 20;
	canvas.height = 68;

	ctx.fillStyle = 'rgba(10,10,10,0.5)';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.fillStyle = 'white';
	ctx.font = '48px sans-serif';
	ctx.fillText(text, 10, 58);

	canvas.style.visibility = "hidden";

	return canvas;
}

function createNodeMesh(count: number, material: THREE.Material): THREE.InstancedMesh {
	const geometry = new THREE.SphereGeometry(1, 16, 16);

	const mesh = new THREE.InstancedMesh(geometry, material, count);
	mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

	return mesh;
}

function createLinkGeometry(linkCount: number, material: THREE.Material): THREE.LineSegments {
	const positions = new Float32Array(linkCount * 6);
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

	return new THREE.LineSegments(geometry, material);
}
