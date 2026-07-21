"use client";

import { Circle, CircleMarker, MapContainer, TileLayer, useMap } from "react-leaflet";
import { useEffect } from "react";
import "leaflet/dist/leaflet.css";

type LocationMapProps = { latitude: number; longitude: number; location: string; radius: number };

function Recenter({ latitude, longitude, radius }: Pick<LocationMapProps, "latitude" | "longitude" | "radius">) {
  const map = useMap();
  useEffect(() => { map.fitBounds([[latitude, longitude], [latitude, longitude]], { padding: [Math.max(90, radius * 5), Math.max(90, radius * 5)], maxZoom: 12 }); }, [latitude, longitude, radius, map]);
  return null;
}

export default function LocationMap({ latitude, longitude, location, radius }: LocationMapProps) {
  const center: [number, number] = [latitude, longitude];
  return <div className="location-map" aria-label={`Interactive map centered on ${location || "your home base"} with a ${radius}-mile radius`}>
    <MapContainer center={center} zoom={11} scrollWheelZoom={false} className="leaflet-map" attributionControl>
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'} />
      <Circle center={center} radius={radius * 1609.344} pathOptions={{ color: "#998aff", fillColor: "#8072f5", fillOpacity: 0.17, weight: 2 }} />
      <CircleMarker center={center} radius={8} pathOptions={{ color: "#f6f4ff", fillColor: "#998aff", fillOpacity: 1, weight: 3 }} />
      <Recenter latitude={latitude} longitude={longitude} radius={radius} />
    </MapContainer>
    <div className="map-label"><b>{location || "Set your home base"}</b><span>{radius}-mile discovery area · {latitude.toFixed(4)}, {longitude.toFixed(4)}</span></div>
  </div>;
}
