# Native map data and libraries

The native MCP Apps view bundles Natural Earth 1:110m country geometry (177 features), with
attributes reduced to country name. Natural Earth data is public domain:
https://www.naturalearthdata.com/about/terms-of-use/

Source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson
Retrieved October 5, 2026. The view shows Natural Earth attribution. These generalized boundaries
are for orientation and do not assert sovereignty or provide navigation guidance. No external
tile, geocoder, analytics, or GPS service is used by the embedded view.

Map rendering uses MapLibre GL JS (BSD-3-Clause); the MCP Apps bridge uses
@modelcontextprotocol/ext-apps (Apache-2.0). Other dependencies retain their package licenses.
