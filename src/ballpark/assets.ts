import catalogJson from '../assets/ballparks/catalog.json';
import { parseBallparkCatalog } from './catalog';

/**
 * The promoted JSON catalog is the only runtime asset boundary. It is parsed
 * fail-closed once at module initialization; simulation adapters ignore its
 * presentation and authoring sections.
 */
export const BALLPARK_ASSET_CATALOG = parseBallparkCatalog(catalogJson);
export const BALLPARK_ASSETS = BALLPARK_ASSET_CATALOG.assets;
